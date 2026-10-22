//! A port of the subset of `magic-string` that the compiler uses.
//!
//! [`MagicString`] edits a source text through a doubly linked list of chunks,
//! exactly like `magic-string` 1.4.3: [`overwrite`](MagicString::overwrite),
//! [`append_left`](MagicString::append_left),
//! [`append_right`](MagicString::append_right),
//! [`prepend`](MagicString::prepend) and [`append`](MagicString::append). The
//! output text ([`render`](MagicString::render)) and the source maps
//! ([`generate_map`](MagicString::generate_map) and
//! [`generate_decoded_map`](MagicString::generate_decoded_map), always with
//! `hires: "boundary"`) are byte-identical to what the JavaScript package
//! produces. The replay tests in `tests/magic.rs` check this against fixtures
//! generated with the real package.
//!
//! # Indexing model
//!
//! Every position the API takes is a UTF-8 **byte offset** into the original
//! text and must sit on a character boundary (otherwise a [`MagicError`] is
//! returned). Source-map columns, however, are counted in UTF-16 code units
//! like JavaScript does: a character outside the BMP counts as two columns and
//! produces two `hires: "boundary"` segments.
//!
//! # Differences from the JavaScript package
//!
//! * Only the subset the compiler needs is ported: no `move`, `remove`,
//!   `slice`, `trim`, `indent`, `clone`, `storeName` or the other `hires`
//!   modes. `names` is therefore always empty.
//! * Chunks live in an arena and are found with an ordered map keyed by chunk
//!   start (`O(log n)` per edit) instead of walking the list from the last
//!   searched chunk. The JavaScript search always lands on the one chunk that
//!   contains the index, so the observable behavior (including which errors
//!   are raised) is identical; only the cost differs.
//! * Error messages are the JavaScript ones, with indexes converted back to
//!   UTF-16 units so the text matches too.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;

/// Marks "no chunk" in the arena links.
const NONE: usize = usize::MAX;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// The category of a [`MagicError`].
///
/// # Examples
///
/// ```
/// use shadow_compiler::magic::{MagicErrorKind, MagicString};
///
/// let mut s = MagicString::new("abc");
/// let err = s.overwrite(1, 1, "x").unwrap_err();
/// assert_eq!(err.kind(), MagicErrorKind::ZeroLengthRange);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MagicErrorKind {
    /// `end` is past the end of the original text.
    OutOfBounds,
    /// `overwrite` was called with `start == end`.
    ZeroLengthRange,
    /// `overwrite` was called with `start > end`.
    InvalidRange,
    /// A split point lies inside a chunk that was already edited.
    SplitEditedChunk,
    /// An overwrite range crosses a split point of the chunk list.
    AcrossSplitPoint,
    /// A byte offset is not on a UTF-8 character boundary (Rust API only).
    NotCharBoundary,
    /// An internal invariant did not hold (never expected).
    Internal,
}

/// The error type of [`MagicString`], the counterpart of `MagicStringError`.
///
/// [`message`](MagicError::message) is the JavaScript text, prefixed with
/// `[MagicString] `.
///
/// # Examples
///
/// ```
/// use shadow_compiler::magic::MagicString;
///
/// let mut s = MagicString::new("abc");
/// let err = s.overwrite(0, 9, "x").unwrap_err();
/// assert_eq!(err.message(), "[MagicString] end 9 is out of bounds");
/// assert_eq!(err.to_string(), err.message());
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MagicError {
    kind: MagicErrorKind,
    message: String,
}

impl MagicError {
    fn new(kind: MagicErrorKind, message: impl fmt::Display) -> Self {
        Self {
            kind,
            message: format!("[MagicString] {message}"),
        }
    }

    /// The category of the error.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::{MagicErrorKind, MagicString};
    ///
    /// let err = MagicString::new("abc").overwrite(2, 1, "x").unwrap_err();
    /// assert_eq!(err.kind(), MagicErrorKind::InvalidRange);
    /// ```
    #[must_use]
    pub fn kind(&self) -> MagicErrorKind {
        self.kind
    }

    /// The full message, including the `[MagicString] ` prefix.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let err = MagicString::new("abc").overwrite(1, 1, "x").unwrap_err();
    /// assert!(err.message().starts_with("[MagicString] cannot overwrite a zero-length range at 1"));
    /// ```
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for MagicError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for MagicError {}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

/// One piece of the original text, plus what was inserted around it.
///
/// For an unedited chunk the content is `original[start..end]`, which is what
/// the JavaScript `Chunk` keeps in `original` and `content` (they are equal
/// until the chunk is edited), so nothing is copied for it.
#[derive(Debug, Clone)]
struct Chunk {
    start: usize,
    end: usize,
    intro: String,
    outro: String,
    /// Only meaningful when `edited`.
    content: String,
    edited: bool,
    /// Arena index of the following chunk, or `NONE`. (The JavaScript
    /// `previous` link is not needed by the ported subset.)
    next: usize,
}

impl Chunk {
    fn content<'a>(&'a self, original: &'a str) -> &'a str {
        if self.edited {
            &self.content
        } else {
            original.get(self.start..self.end).unwrap_or_default()
        }
    }

    fn content_len(&self) -> usize {
        if self.edited {
            self.content.len()
        } else {
            self.end - self.start
        }
    }

    /// `chunk.edit("", false, false)`: empty content, intro and outro dropped.
    fn clear(&mut self) {
        self.content = String::new();
        self.intro = String::new();
        self.outro = String::new();
        self.edited = true;
    }
}

// ---------------------------------------------------------------------------
// UTF-16 helpers
// ---------------------------------------------------------------------------

/// Length of `s` in UTF-16 code units.
fn utf16_len(s: &str) -> usize {
    let mut n = 0;
    for &b in s.as_bytes() {
        // Count every UTF-8 lead byte once, and 4-byte sequences twice.
        n += usize::from((b & 0xC0) != 0x80) + usize::from(b >= 0xF0);
    }
    n
}

/// `[A-Za-z0-9_]`, the word characters of `hires: "boundary"`.
fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Converts a `usize` to `u32`, saturating (maps never get near the limit).
fn to_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Incremental `getLocator`: maps ascending byte offsets to `(line, column)`
/// with the column in UTF-16 units. Chunks are visited in ascending order, so
/// a single forward scan is enough (a backwards request restarts from zero).
struct Locator<'a> {
    bytes: &'a [u8],
    pos: usize,
    line: usize,
    column: usize,
}

impl<'a> Locator<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            bytes: text.as_bytes(),
            pos: 0,
            line: 0,
            column: 0,
        }
    }

    fn locate(&mut self, index: usize) -> (usize, usize) {
        if index < self.pos {
            self.pos = 0;
            self.line = 0;
            self.column = 0;
        }
        for &b in self.bytes.get(self.pos..index).unwrap_or_default() {
            if b == b'\n' {
                self.line += 1;
                self.column = 0;
            } else {
                self.column += usize::from((b & 0xC0) != 0x80) + usize::from(b >= 0xF0);
            }
        }
        self.pos = index;
        (self.line, self.column)
    }
}

/// Port of `getRelativePath`.
fn get_relative_path(from: &str, to: &str) -> String {
    let mut from_parts: Vec<&str> = from.split(['/', '\\']).collect();
    let to_parts: Vec<&str> = to.split(['/', '\\']).collect();
    from_parts.pop();
    let mut f = 0;
    let mut t = 0;
    while let (Some(a), Some(b)) = (from_parts.get(f), to_parts.get(t)) {
        if a != b {
            break;
        }
        f += 1;
        t += 1;
    }
    let mut parts: Vec<&str> = Vec::new();
    parts.extend(std::iter::repeat_n(
        "..",
        from_parts.len().saturating_sub(f),
    ));
    parts.extend(to_parts.get(t..).unwrap_or_default());
    parts.join("/")
}

// ---------------------------------------------------------------------------
// Source maps
// ---------------------------------------------------------------------------

/// A version 3 source map with the `mappings` already VLQ-encoded, the
/// counterpart of the JavaScript `SourceMap` object.
///
/// # Examples
///
/// ```
/// use shadow_compiler::magic::MagicString;
///
/// let mut s = MagicString::new("a b");
/// s.overwrite(0, 1, "x").unwrap();
/// let map = s.generate_map(Some("in.tsx"), true);
/// assert_eq!(map.sources, ["in.tsx"]);
/// assert_eq!(map.sources_content, Some(vec!["a b".to_owned()]));
/// assert!(map.names.is_empty());
/// assert_eq!(map.mappings, "AAAA,CAAC,CAAC");
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMapData {
    /// The `sources` array (always exactly one entry).
    pub sources: Vec<String>,
    /// `sourcesContent`; `None` when content was not requested (the field is
    /// then absent from the JSON, like `undefined` in JavaScript).
    pub sources_content: Option<Vec<String>>,
    /// The `names` array (always empty here).
    pub names: Vec<String>,
    /// The VLQ-encoded `mappings` string.
    pub mappings: String,
}

impl SourceMapData {
    /// Serializes the map exactly like `JSON.stringify` of the JavaScript
    /// `SourceMap`: keys `version`, `sources`, `sourcesContent` (if any),
    /// `names`, `mappings`.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let s = MagicString::new("hi");
    /// let json = s.generate_map(Some("a.tsx"), false).to_json();
    /// assert_eq!(json, r#"{"version":3,"sources":["a.tsx"],"names":[],"mappings":"AAAA"}"#);
    /// ```
    #[must_use]
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(self.mappings.len() + 64);
        out.push_str("{\"version\":3,\"sources\":");
        push_json_array(&mut out, &self.sources);
        if let Some(content) = &self.sources_content {
            out.push_str(",\"sourcesContent\":");
            push_json_array(&mut out, content);
        }
        out.push_str(",\"names\":");
        push_json_array(&mut out, &self.names);
        out.push_str(",\"mappings\":");
        push_json_string(&mut out, &self.mappings);
        out.push('}');
        out
    }
}

fn push_json_array(out: &mut String, items: &[String]) {
    out.push('[');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        push_json_string(out, item);
    }
    out.push(']');
}

/// `JSON.stringify` for one string.
fn push_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if u32::from(c) < 0x20 => {
                out.push_str("\\u00");
                for shift in [4u32, 0] {
                    let digit = (u32::from(c) >> shift) & 0xF;
                    out.push(char::from_digit(digit, 16).unwrap_or('0'));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// A source map whose `mappings` are still arrays, the counterpart of
/// `generateDecodedMap`.
///
/// Each generated line holds its segments as `[generated column, source index,
/// source line, source column]` (all zero-based, columns in UTF-16 units).
///
/// # Examples
///
/// ```
/// use shadow_compiler::magic::MagicString;
///
/// let s = MagicString::new("a\nb");
/// let map = s.generate_decoded_map(Some("in.tsx"), false);
/// assert_eq!(map.mappings, vec![vec![[0, 0, 0, 0]], vec![[0, 0, 1, 0]]]);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedMap {
    /// The `sources` array (always exactly one entry).
    pub sources: Vec<String>,
    /// `sourcesContent`; `None` when content was not requested.
    pub sources_content: Option<Vec<String>>,
    /// The `names` array (always empty here).
    pub names: Vec<String>,
    /// One entry per generated line; each segment is
    /// `[generated column, source index, source line, source column]`.
    pub mappings: Vec<Vec<[u32; 4]>>,
}

/// Receives the segments produced by [`Mappings`].
trait Sink {
    fn segment(&mut self, generated_column: usize, line: usize, column: usize);
    fn end_line(&mut self);

    /// Maps a run of ASCII bytes without line breaks, `hires: "boundary"` style: a segment at each
    /// non-word byte and at the first byte of each word. Advances `generated_column` and `column`
    /// over the run.
    fn ascii_run(
        &mut self,
        run: &[u8],
        generated_column: &mut usize,
        line: usize,
        column: &mut usize,
        in_word: &mut bool,
    ) {
        ascii_run_each(self, run, generated_column, line, column, in_word);
    }
}

/// The segments of an ASCII run, one at a time (`hires: "boundary"`).
fn ascii_run_each<S: Sink + ?Sized>(
    sink: &mut S,
    run: &[u8],
    generated_column: &mut usize,
    line: usize,
    column: &mut usize,
    in_word: &mut bool,
) {
    for &byte in run {
        if is_word(byte) {
            if !*in_word {
                sink.segment(*generated_column, line, *column);
                *in_word = true;
            }
        } else {
            sink.segment(*generated_column, line, *column);
            *in_word = false;
        }
        *column += 1;
        *generated_column += 1;
    }
}

/// Points the source positions of a map at another text: the positions a [`MagicString`] reports are
/// those of the text it edits, and a caller that edited that text from an older one wants the
/// positions of the older text.
pub trait Retrace {
    /// The position `(line, column)` of the older text for a position of the edited text.
    fn point(&mut self, line: usize, column: usize) -> (usize, usize);

    /// The position of the older text for the start of an ASCII run of `len` bytes on one line of the
    /// edited text, when the whole run moves as one (the older text holds the same run on one line).
    /// `None` when it does not, and the run is retraced byte by byte.
    fn run(&mut self, line: usize, column: usize, len: usize) -> Option<(usize, usize)>;
}

/// An [`Encoder`] that retraces every segment.
struct Retracing<'r, R: Retrace> {
    inner: Encoder,
    retrace: &'r mut R,
}

impl<R: Retrace> Sink for Retracing<'_, R> {
    fn segment(&mut self, generated_column: usize, line: usize, column: usize) {
        let (line, column) = self.retrace.point(line, column);
        self.inner.segment(generated_column, line, column);
    }

    fn end_line(&mut self) {
        self.inner.end_line();
    }

    fn ascii_run(
        &mut self,
        run: &[u8],
        generated_column: &mut usize,
        line: usize,
        column: &mut usize,
        in_word: &mut bool,
    ) {
        if let Some((moved_line, mut moved_column)) = self.retrace.run(line, *column, run.len()) {
            self.inner.ascii_run(
                run,
                generated_column,
                moved_line,
                &mut moved_column,
                in_word,
            );
            *column += run.len();
        } else {
            ascii_run_each(self, run, generated_column, line, column, in_word);
        }
    }
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Port of `MappingsEncoder`: the VLQ `mappings` string, built incrementally.
/// The single source index is always 0, so its delta is always 0 (`A`).
struct Encoder {
    out: Vec<u8>,
    needs_comma: bool,
    prev_generated_column: i64,
    prev_line: i64,
    prev_column: i64,
}

impl Encoder {
    fn new(capacity: usize) -> Self {
        Self {
            out: Vec::with_capacity(capacity),
            needs_comma: false,
            prev_generated_column: 0,
            prev_line: 0,
            prev_column: 0,
        }
    }

    #[inline]
    fn write_vlq(&mut self, value: i64) {
        let mut n = (value.unsigned_abs() << 1) | u64::from(value < 0);
        loop {
            let mut digit = (n & 31) as usize;
            n >>= 5;
            if n > 0 {
                digit |= 32;
            }
            self.out.push(BASE64[digit & 63]);
            if n == 0 {
                break;
            }
        }
    }

    fn into_string(self) -> String {
        // Only characters of the base64 alphabet, `,` and `;` are ever written.
        String::from_utf8(self.out).unwrap_or_default()
    }
}

impl Sink for Encoder {
    fn segment(&mut self, generated_column: usize, line: usize, column: usize) {
        if self.needs_comma {
            self.out.push(b',');
        }
        self.needs_comma = true;
        let (g, l, c) = (generated_column as i64, line as i64, column as i64);
        self.write_vlq(g - self.prev_generated_column);
        self.prev_generated_column = g;
        self.write_vlq(0);
        self.write_vlq(l - self.prev_line);
        self.prev_line = l;
        self.write_vlq(c - self.prev_column);
        self.prev_column = c;
    }

    fn end_line(&mut self) {
        self.out.push(b';');
        self.needs_comma = false;
        self.prev_generated_column = 0;
    }

    fn ascii_run(
        &mut self,
        run: &[u8],
        generated_column: &mut usize,
        line: usize,
        column: &mut usize,
        in_word: &mut bool,
    ) {
        // After the first segment of a run both columns advance in step, so a later segment is
        // `,<d>AA<d>` with `d` the distance from the previous segment: one character for d < 16.
        let mut last: Option<usize> = None;
        for (offset, &byte) in run.iter().enumerate() {
            let word = is_word(byte);
            if word && *in_word {
                continue;
            }
            *in_word = word;
            match last {
                None => self.segment(*generated_column + offset, line, *column + offset),
                Some(previous) => {
                    let distance = offset - previous;
                    self.out.push(b',');
                    if distance < 16 {
                        let digit = BASE64[distance << 1];
                        self.out.extend_from_slice(&[digit, b'A', b'A', digit]);
                    } else {
                        self.write_vlq(distance as i64);
                        self.out.extend_from_slice(b"AA");
                        self.write_vlq(distance as i64);
                    }
                    self.prev_generated_column += distance as i64;
                    self.prev_column += distance as i64;
                }
            }
            last = Some(offset);
        }
        *generated_column += run.len();
        *column += run.len();
    }
}

/// Collects raw segments, like `Mappings.raw`.
struct Decoder {
    lines: Vec<Vec<[u32; 4]>>,
}

impl Sink for Decoder {
    fn segment(&mut self, generated_column: usize, line: usize, column: usize) {
        if let Some(current) = self.lines.last_mut() {
            current.push([to_u32(generated_column), 0, to_u32(line), to_u32(column)]);
        }
    }

    fn end_line(&mut self) {
        self.lines.push(Vec::new());
    }
}

/// Port of `Mappings` with `hires: "boundary"`.
struct Mappings<S: Sink> {
    sink: S,
    generated_column: usize,
}

impl<S: Sink> Mappings<S> {
    fn new(sink: S) -> Self {
        Self {
            sink,
            generated_column: 0,
        }
    }

    fn next_line(&mut self) {
        self.sink.end_line();
        self.generated_column = 0;
    }

    fn push_segment(&mut self, line: usize, column: usize) {
        self.sink.segment(self.generated_column, line, column);
    }

    /// `addEdit`: one segment per line of the new content, all pointing at
    /// the start of the replaced chunk. A trailing newline does not start a
    /// segment of its own.
    fn add_edit(&mut self, content: &str, line: usize, column: usize) {
        if content.is_empty() {
            return;
        }
        let bytes = content.as_bytes();
        let last = bytes.len() - 1;
        let mut line_start = 0;
        let mut search = 0;
        while let Some(offset) = bytes
            .get(search..)
            .and_then(|rest| rest.iter().position(|&b| b == b'\n'))
        {
            let at = search + offset;
            if last <= at {
                break;
            }
            self.push_segment(line, column);
            self.next_line();
            line_start = at + 1;
            search = at + 1;
        }
        self.push_segment(line, column);
        self.advance(content.get(line_start..).unwrap_or_default());
    }

    /// `addUneditedChunk` for `hires: "boundary"`. `line` and `column` track
    /// the source position and are advanced through the chunk.
    fn add_unedited(&mut self, text: &str, line: &mut usize, column: &mut usize) {
        let bytes = text.as_bytes();
        let mut in_word = false;
        let mut index = 0;
        while let Some(&byte) = bytes.get(index) {
            if byte != b'\n' && byte < 0x80 {
                let end = bytes
                    .get(index..)
                    .and_then(|rest| rest.iter().position(|&b| b == b'\n' || b >= 0x80))
                    .map_or(bytes.len(), |length| index + length);
                if let Some(run) = bytes.get(index..end) {
                    self.sink.ascii_run(
                        run,
                        &mut self.generated_column,
                        *line,
                        column,
                        &mut in_word,
                    );
                }
                index = end;
                continue;
            }
            if byte == b'\n' {
                *line += 1;
                *column = 0;
                self.next_line();
                in_word = false;
            } else if (byte & 0xC0) != 0x80 {
                // A non-ASCII character is one UTF-16 unit, or two for a 4-byte sequence; no unit
                // is a word character.
                let units = if byte >= 0xF0 { 2 } else { 1 };
                for _ in 0..units {
                    self.push_segment(*line, *column);
                    *column += 1;
                    self.generated_column += 1;
                }
                in_word = false;
            }
            index += 1;
        }
    }

    /// `advance`: moves the generated position over `text` without mapping.
    fn advance(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut tail_start = 0;
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                self.next_line();
                tail_start = i + 1;
            }
        }
        self.generated_column += utf16_len(text.get(tail_start..).unwrap_or_default());
    }
}

// ---------------------------------------------------------------------------
// MagicString
// ---------------------------------------------------------------------------

/// Edits a source text and tracks a source map, a port of the subset of
/// `magic-string`'s `MagicString` that the compiler uses.
///
/// See the [module documentation](self) for the indexing model.
///
/// # Examples
///
/// ```
/// use shadow_compiler::magic::MagicString;
///
/// let mut s = MagicString::new("let a = <b/>;");
/// s.overwrite(8, 12, "h('b')").unwrap();
/// s.prepend("// generated\n");
/// assert_eq!(s.render(), "// generated\nlet a = h('b');");
/// ```
#[derive(Debug, Clone)]
pub struct MagicString<'a> {
    original: Cow<'a, str>,
    intro: String,
    outro: String,
    /// Chunk arena; index 0 is always the first chunk of the list.
    chunks: Vec<Chunk>,
    /// Chunk start offset -> arena index (`byStart`). `byEnd` is derived: the
    /// chunks tile the text, so a chunk ends where the next one starts.
    by_start: BTreeMap<usize, usize>,
}

impl<'a> MagicString<'a> {
    /// Creates a `MagicString` over `original` (an owned `String`, or a `&str` that is not copied).
    ///
    /// Takes ownership of the text (a `&str` is copied once, a `String` is
    /// moved), because chunks refer to it for the whole lifetime.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let s = MagicString::new("abc");
    /// assert_eq!(s.render(), "abc");
    /// assert_eq!(s.original(), "abc");
    /// ```
    #[must_use]
    pub fn new(original: impl Into<Cow<'a, str>>) -> Self {
        let original = original.into();
        let first = Chunk {
            start: 0,
            end: original.len(),
            intro: String::new(),
            outro: String::new(),
            content: String::new(),
            edited: false,
            next: NONE,
        };
        let mut by_start = BTreeMap::new();
        by_start.insert(0, 0);
        Self {
            original,
            intro: String::new(),
            outro: String::new(),
            chunks: vec![first],
            by_start,
        }
    }

    /// The original text this value was created with.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("abc");
    /// s.append("!");
    /// assert_eq!(s.original(), "abc");
    /// ```
    #[must_use]
    pub fn original(&self) -> &str {
        &self.original
    }

    /// `index` as a JavaScript (UTF-16) index, for error messages. Offsets
    /// past the end keep their distance from the end.
    fn utf16_index(&self, index: usize) -> usize {
        let len = self.original.len();
        if index >= len {
            return utf16_len(&self.original) + (index - len);
        }
        let mut at = index;
        while at > 0 && !self.original.is_char_boundary(at) {
            at -= 1;
        }
        utf16_len(self.original.get(..at).unwrap_or_default())
    }

    fn check_boundary(&self, index: usize) -> Result<(), MagicError> {
        if index <= self.original.len() && !self.original.is_char_boundary(index) {
            return Err(MagicError::new(
                MagicErrorKind::NotCharBoundary,
                format!("index {index} is not on a UTF-8 character boundary"),
            ));
        }
        Ok(())
    }

    fn internal(what: &str) -> MagicError {
        MagicError::new(MagicErrorKind::Internal, format!("internal error: {what}"))
    }

    /// `_split`: makes `index` a chunk boundary.
    fn split(&mut self, index: usize) -> Result<(), MagicError> {
        // Already a boundary (`byStart`/`byEnd`, the end of the text included)
        // or out of bounds, where the JavaScript search finds nothing to split.
        if index >= self.original.len() || self.by_start.contains_key(&index) {
            return Ok(());
        }
        let Some((_, &id)) = self.by_start.range(..index).next_back() else {
            return Ok(());
        };
        let chunk = &self.chunks[id];
        if chunk.start < index && index < chunk.end {
            self.split_chunk(id, index)
        } else {
            Ok(())
        }
    }

    /// `_splitChunk` + `Chunk.split`.
    fn split_chunk(&mut self, id: usize, index: usize) -> Result<(), MagicError> {
        let chunk = &self.chunks[id];
        if chunk.edited && !chunk.content.is_empty() {
            let (line, column) = Locator::new(&self.original).locate(index);
            let original = self
                .original
                .get(chunk.start..chunk.end)
                .unwrap_or_default();
            return Err(MagicError::new(
                MagicErrorKind::SplitEditedChunk,
                format!(
                    "cannot split a chunk that has already been edited ({line}:{column} \u{2013} \"{original}\")"
                ),
            ));
        }
        let new_id = self.chunks.len();
        let chunk = &mut self.chunks[id];
        let next = chunk.next;
        let new_chunk = Chunk {
            start: index,
            end: chunk.end,
            intro: String::new(),
            outro: std::mem::take(&mut chunk.outro),
            content: String::new(),
            edited: chunk.edited,
            next,
        };
        chunk.end = index;
        chunk.content = String::new();
        chunk.next = new_id;
        self.chunks.push(new_chunk);
        self.by_start.insert(index, new_id);
        Ok(())
    }

    /// `byEnd.get(index)`.
    fn chunk_ending_at(&self, index: usize) -> Option<usize> {
        if index == 0 {
            // Only the chunk of an empty text ends at 0.
            return self.original.is_empty().then_some(0);
        }
        let (_, &id) = self.by_start.range(..index).next_back()?;
        (self.chunks[id].end == index).then_some(id)
    }

    /// Replaces the characters from `start` to `end` with `content`, together
    /// with anything inserted in that range, like `s.overwrite(start, end,
    /// content)` with no options.
    ///
    /// Content attached inside the range or at its two edges with
    /// [`append_left`](Self::append_left)/[`append_right`](Self::append_right)
    /// is dropped too, except what hangs on the outer sides (the left insert
    /// at `start` and the right insert at `end`). `content` can be a `&str`
    /// (copied) or a `String` (moved).
    ///
    /// # Errors
    ///
    /// Returns a [`MagicError`] when `end` is past the end, `start == end`,
    /// `start > end`, an offset is not on a character boundary, or an end of
    /// the range falls inside a chunk that already holds replacement text.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("one two three");
    /// s.overwrite(4, 7, "2").unwrap();
    /// assert_eq!(s.render(), "one 2 three");
    /// assert!(s.overwrite(5, 6, "x").is_err());
    /// ```
    pub fn overwrite(
        &mut self,
        start: usize,
        end: usize,
        content: impl Into<String>,
    ) -> Result<(), MagicError> {
        let len = self.original.len();
        if end > len {
            return Err(MagicError::new(
                MagicErrorKind::OutOfBounds,
                format!("end {} is out of bounds", self.utf16_index(end)),
            ));
        }
        if start == end {
            return Err(MagicError::new(
                MagicErrorKind::ZeroLengthRange,
                format!(
                    "cannot overwrite a zero-length range at {}, use appendLeft() or prependRight()",
                    self.utf16_index(start)
                ),
            ));
        }
        if start > end {
            return Err(MagicError::new(
                MagicErrorKind::InvalidRange,
                format!(
                    "end must be greater than start (start: {}, end: {})",
                    self.utf16_index(start),
                    self.utf16_index(end)
                ),
            ));
        }
        self.check_boundary(start)?;
        self.check_boundary(end)?;
        self.split(start)?;
        self.split(end)?;
        let (Some(&first), Some((_, &last))) = (
            self.by_start.get(&start),
            self.by_start.range(..end).next_back(),
        ) else {
            return Err(Self::internal("missing chunk after split"));
        };
        let mut current = first;
        while current != last {
            let next = self.chunks[current].next;
            if next == NONE || self.chunks[next].start != self.chunks[current].end {
                return Err(MagicError::new(
                    MagicErrorKind::AcrossSplitPoint,
                    "cannot overwrite across a split point",
                ));
            }
            current = next;
            self.chunks[current].clear();
        }
        let chunk = &mut self.chunks[first];
        chunk.clear();
        chunk.content = content.into();
        Ok(())
    }

    /// Inserts `content` at `index` so that it stays attached to the text
    /// *before* `index` (`appendLeft`). Later calls at the same index land
    /// after earlier ones.
    ///
    /// An `index` past the end of the original text does not fail (as in
    /// JavaScript): the content goes to the very start of the output.
    ///
    /// # Errors
    ///
    /// Returns a [`MagicError`] if `index` is not on a character boundary or
    /// lies inside a chunk that already holds replacement text.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("ab");
    /// s.append_left(1, "<L>").unwrap();
    /// s.append_right(1, "<R>").unwrap();
    /// assert_eq!(s.render(), "a<L><R>b");
    /// ```
    pub fn append_left(&mut self, index: usize, content: &str) -> Result<(), MagicError> {
        if index <= self.original.len() {
            self.check_boundary(index)?;
            self.split(index)?;
        }
        match self.chunk_ending_at(index) {
            Some(id) => self.chunks[id].outro.push_str(content),
            None => self.intro.push_str(content),
        }
        Ok(())
    }

    /// Inserts `content` at `index` so that it stays attached to the text
    /// *after* `index` (`appendRight`). Later calls at the same index land
    /// after earlier ones.
    ///
    /// An `index` past the end of the original text does not fail (as in
    /// JavaScript): the content goes to the very end of the output.
    ///
    /// # Errors
    ///
    /// Returns a [`MagicError`] if `index` is not on a character boundary or
    /// lies inside a chunk that already holds replacement text.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("ab");
    /// s.append_right(1, "1").unwrap();
    /// s.append_right(1, "2").unwrap();
    /// assert_eq!(s.render(), "a12b");
    /// ```
    pub fn append_right(&mut self, index: usize, content: &str) -> Result<(), MagicError> {
        if index <= self.original.len() {
            self.check_boundary(index)?;
            self.split(index)?;
        }
        match self.by_start.get(&index) {
            Some(&id) => self.chunks[id].intro.push_str(content),
            None => self.outro.push_str(content),
        }
        Ok(())
    }

    /// Puts `content` before everything else, including earlier prepends.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("x");
    /// s.prepend("b");
    /// s.prepend("a");
    /// assert_eq!(s.render(), "abx");
    /// ```
    pub fn prepend(&mut self, content: &str) {
        self.intro.insert_str(0, content);
    }

    /// Puts `content` after everything else.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("x");
    /// s.append("y");
    /// s.append("z");
    /// assert_eq!(s.render(), "xyz");
    /// ```
    pub fn append(&mut self, content: &str) {
        self.outro.push_str(content);
    }

    /// Walks the chunk list from the first chunk.
    fn chunk_list(&self) -> impl Iterator<Item = &Chunk> {
        let mut next = 0;
        std::iter::from_fn(move || {
            if next == NONE {
                return None;
            }
            let chunk = self.chunks.get(next)?;
            next = chunk.next;
            Some(chunk)
        })
    }

    /// Calls `f` with every piece of the output, in order.
    fn for_each_piece(&self, mut f: impl FnMut(&str)) {
        f(&self.intro);
        for chunk in self.chunk_list() {
            f(&chunk.intro);
            f(chunk.content(&self.original));
            f(&chunk.outro);
        }
        f(&self.outro);
    }

    /// Appends the generated text to `out`.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("abc");
    /// s.overwrite(1, 2, "-").unwrap();
    /// let mut out = String::from(">");
    /// s.write_to(&mut out);
    /// assert_eq!(out, ">a-c");
    /// ```
    pub fn write_to(&self, out: &mut String) {
        self.for_each_piece(|piece| out.push_str(piece));
    }

    /// The generated text (`toString()` in JavaScript), built into a single
    /// pre-sized `String`.
    ///
    /// [`Display`](fmt::Display) gives the same text, but `to_string()` on it
    /// cannot pre-size the buffer; prefer this method.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("abc");
    /// s.append_left(3, "!");
    /// assert_eq!(s.render(), "abc!");
    /// ```
    #[must_use]
    pub fn render(&self) -> String {
        let mut capacity = self.intro.len() + self.outro.len();
        for chunk in self.chunk_list() {
            capacity += chunk.intro.len() + chunk.content_len() + chunk.outro.len();
        }
        let mut out = String::with_capacity(capacity);
        self.write_to(&mut out);
        out
    }

    /// Feeds the whole text through `mappings` (`_generateMappings`).
    fn generate_mappings<S: Sink>(&self, mappings: &mut Mappings<S>) {
        let mut locator = Locator::new(&self.original);
        mappings.advance(&self.intro);
        for chunk in self.chunk_list() {
            let (mut line, mut column) = locator.locate(chunk.start);
            mappings.advance(&chunk.intro);
            if chunk.edited {
                mappings.add_edit(&chunk.content, line, column);
            } else {
                let text = self
                    .original
                    .get(chunk.start..chunk.end)
                    .unwrap_or_default();
                mappings.add_unedited(text, &mut line, &mut column);
            }
            mappings.advance(&chunk.outro);
        }
        mappings.advance(&self.outro);
    }

    /// `[source ? getRelativePath("", source) : ""]`.
    fn map_sources(source: Option<&str>) -> Vec<String> {
        vec![match source {
            Some(s) if !s.is_empty() => get_relative_path("", s),
            _ => String::new(),
        }]
    }

    /// Generates the encoded source map, like `generateMap({ source, hires:
    /// "boundary", includeContent })`.
    ///
    /// With `hires: "boundary"` every non-word character (and the first
    /// character of each word) gets its own segment. Columns are UTF-16 units.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let s = MagicString::new("foo()");
    /// let map = s.generate_map(Some("dir\\a.tsx"), true);
    /// assert_eq!(map.sources, ["dir/a.tsx"]);
    /// assert_eq!(map.mappings, "AAAA,GAAG,CAAC");
    /// ```
    #[must_use]
    pub fn generate_map(&self, source: Option<&str>, include_content: bool) -> SourceMapData {
        let capacity = self.original.len().saturating_mul(2).min(1 << 26);
        let mut mappings = Mappings::new(Encoder::new(capacity));
        self.generate_mappings(&mut mappings);
        SourceMapData {
            sources: Self::map_sources(source),
            sources_content: include_content.then(|| vec![self.original.to_string()]),
            names: Vec::new(),
            mappings: mappings.sink.into_string(),
        }
    }

    /// Generates the encoded source map like [`generate_map`](MagicString::generate_map) (without the
    /// content), with every source position passed through `retrace`.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::{MagicString, Retrace};
    ///
    /// /// The text was edited from one that had a line more in front of it.
    /// struct OneLineUp;
    /// impl Retrace for OneLineUp {
    ///     fn point(&mut self, line: usize, column: usize) -> (usize, usize) {
    ///         (line + 1, column)
    ///     }
    ///     fn run(&mut self, line: usize, column: usize, _len: usize) -> Option<(usize, usize)> {
    ///         Some((line + 1, column))
    ///     }
    /// }
    ///
    /// let s = MagicString::new("a b");
    /// let map = s.generate_retraced_map(Some("in.tsx"), &mut OneLineUp);
    /// assert_eq!(map.mappings, "AACA,CAAC,CAAC");
    /// ```
    #[must_use]
    pub fn generate_retraced_map<R: Retrace>(
        &self,
        source: Option<&str>,
        retrace: &mut R,
    ) -> SourceMapData {
        let capacity = self.original.len().saturating_mul(2).min(1 << 26);
        let mut mappings = Mappings::new(Retracing {
            inner: Encoder::new(capacity),
            retrace,
        });
        self.generate_mappings(&mut mappings);
        SourceMapData {
            sources: Self::map_sources(source),
            sources_content: None,
            names: Vec::new(),
            mappings: mappings.sink.inner.into_string(),
        }
    }

    /// Generates the decoded source map, like `generateDecodedMap({ source,
    /// hires: "boundary", includeContent })`.
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("a b");
    /// s.overwrite(0, 1, "x\ny").unwrap();
    /// let map = s.generate_decoded_map(None, false);
    /// assert_eq!(map.sources, [""]);
    /// assert_eq!(map.mappings[0], vec![[0, 0, 0, 0]]);
    /// assert_eq!(map.mappings[1], vec![[0, 0, 0, 0], [1, 0, 0, 1], [2, 0, 0, 2]]);
    /// ```
    #[must_use]
    pub fn generate_decoded_map(&self, source: Option<&str>, include_content: bool) -> DecodedMap {
        let mut mappings = Mappings::new(Decoder {
            lines: vec![Vec::new()],
        });
        self.generate_mappings(&mut mappings);
        DecodedMap {
            sources: Self::map_sources(source),
            sources_content: include_content.then(|| vec![self.original.to_string()]),
            names: Vec::new(),
            mappings: mappings.sink.lines,
        }
    }
}

impl fmt::Display for MagicString<'_> {
    /// Writes the generated text; same output as [`render`](MagicString::render).
    ///
    /// # Examples
    ///
    /// ```
    /// use shadow_compiler::magic::MagicString;
    ///
    /// let mut s = MagicString::new("abc");
    /// s.prepend(">");
    /// assert_eq!(s.to_string(), ">abc");
    /// ```
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut result = Ok(());
        self.for_each_piece(|piece| {
            if result.is_ok() {
                result = f.write_str(piece);
            }
        });
        result
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn append_orders_at_one_index() {
        let mut s = MagicString::new("ab");
        s.append_right(1, "R1").unwrap();
        s.append_left(1, "L1").unwrap();
        s.append_right(1, "R2").unwrap();
        s.append_left(1, "L2").unwrap();
        assert_eq!(s.render(), "aL1L2R1R2b");
    }

    #[test]
    fn inserts_at_the_edges_of_the_text() {
        let mut s = MagicString::new("ab");
        s.append_left(0, "A").unwrap();
        s.append_right(0, "B").unwrap();
        s.append_left(2, "C").unwrap();
        s.append_right(2, "D").unwrap();
        assert_eq!(s.render(), "ABabCD");
        // Past the end: appendLeft appends to the intro, appendRight to the outro.
        s.append_left(9, "<").unwrap();
        s.append_right(9, ">").unwrap();
        assert_eq!(s.render(), "A<BabCD>");
    }

    #[test]
    fn empty_original_keeps_insert_order() {
        let mut s = MagicString::new("");
        s.append_right(0, "R").unwrap();
        s.append_left(0, "L").unwrap();
        assert_eq!(s.render(), "RL");
        assert_eq!(s.generate_map(None, false).mappings, "");
        let err = s.overwrite(0, 0, "x").unwrap_err();
        assert_eq!(err.kind(), MagicErrorKind::ZeroLengthRange);
    }

    #[test]
    fn overwrite_clears_inserts_inside_and_at_the_edges() {
        let mut s = MagicString::new("0123456789");
        s.append_left(2, "a").unwrap();
        s.append_right(2, "b").unwrap();
        s.append_left(4, "c").unwrap();
        s.append_right(4, "d").unwrap();
        s.append_left(6, "e").unwrap();
        s.append_right(6, "f").unwrap();
        s.overwrite(2, 6, "X").unwrap();
        // `a` hangs on the left neighbor and `f` on the right neighbor.
        assert_eq!(s.render(), "01aXf6789");
    }

    #[test]
    fn overwrite_errors_match_javascript_messages() {
        // 16 bytes, 14 UTF-16 units (the emoji is 4 bytes and 2 units).
        let mut s = MagicString::new("hello \u{1F600} world");
        let err = s.overwrite(0, 20, "x").unwrap_err();
        assert_eq!(err.message(), "[MagicString] end 18 is out of bounds");
        let err = s.overwrite(10, 10, "x").unwrap_err();
        assert_eq!(
            err.message(),
            "[MagicString] cannot overwrite a zero-length range at 8, use appendLeft() or prependRight()"
        );
        let err = s.overwrite(10, 3, "x").unwrap_err();
        assert_eq!(
            err.message(),
            "[MagicString] end must be greater than start (start: 8, end: 3)"
        );
        let err = s.overwrite(0, 8, "x").unwrap_err();
        assert_eq!(err.kind(), MagicErrorKind::NotCharBoundary);
        assert!(s.append_left(8, "x").is_err());
        assert!(s.append_right(7, "x").is_err());
    }

    #[test]
    fn cannot_split_an_edited_chunk() {
        let mut s = MagicString::new("ab\u{1F600}cd\nef");
        s.overwrite(0, 8, "XY").unwrap();
        let err = s.overwrite(2, 6, "z").unwrap_err();
        assert_eq!(err.kind(), MagicErrorKind::SplitEditedChunk);
        assert_eq!(
            err.message(),
            "[MagicString] cannot split a chunk that has already been edited (0:2 \u{2013} \"ab\u{1F600}cd\")"
        );
        // The failed call changed nothing visible.
        assert_eq!(s.render(), "XY\nef");
    }

    #[test]
    fn deleting_leaves_a_splittable_chunk() {
        let mut s = MagicString::new("abcdef");
        s.overwrite(1, 5, "").unwrap();
        s.append_left(3, "x").unwrap();
        s.overwrite(2, 4, "").unwrap();
        assert_eq!(s.render(), "af");
    }

    #[test]
    fn maps_for_a_simple_edit() {
        let mut s = MagicString::new("a b");
        s.overwrite(0, 1, "x").unwrap();
        let map = s.generate_map(Some("in.tsx"), true);
        assert_eq!(map.mappings, "AAAA,CAAC,CAAC");
        assert_eq!(
            map.to_json(),
            "{\"version\":3,\"sources\":[\"in.tsx\"],\"sourcesContent\":[\"a b\"],\"names\":[],\"mappings\":\"AAAA,CAAC,CAAC\"}"
        );
    }

    #[test]
    fn non_bmp_characters_count_two_columns() {
        let s = MagicString::new("\u{1F600}a");
        let map = s.generate_decoded_map(None, false);
        assert_eq!(
            map.mappings,
            vec![vec![[0, 0, 0, 0], [1, 0, 0, 1], [2, 0, 0, 2]]]
        );
        // The overwrite sits on the second line, after the emoji.
        let mut s = MagicString::new("\u{1F600}\nx");
        s.overwrite(5, 6, "y").unwrap();
        let map = s.generate_decoded_map(None, false);
        assert_eq!(map.mappings[0], vec![[0, 0, 0, 0], [1, 0, 0, 1]]);
        assert_eq!(map.mappings[1], vec![[0, 0, 1, 0]]);
    }

    #[test]
    fn edit_content_lines_each_get_a_segment() {
        let mut s = MagicString::new("abc");
        s.overwrite(1, 2, "p\nq\n").unwrap();
        let map = s.generate_decoded_map(None, false);
        assert_eq!(
            map.mappings,
            vec![
                vec![[0, 0, 0, 0], [1, 0, 0, 1]],
                vec![[0, 0, 0, 1]],
                vec![[0, 0, 0, 2]],
            ]
        );
    }

    #[test]
    fn relative_path_normalizes_separators() {
        assert_eq!(get_relative_path("", "a.tsx"), "a.tsx");
        assert_eq!(get_relative_path("", "C:\\x\\y.tsx"), "C:/x/y.tsx");
        assert_eq!(get_relative_path("", "/abs/d.tsx"), "/abs/d.tsx");
        assert_eq!(get_relative_path("src/a.js", "src/b/c.js"), "b/c.js");
        assert_eq!(get_relative_path("src/x/a.js", "src/c.js"), "../c.js");
    }

    #[test]
    fn json_escapes_like_json_stringify() {
        let mut out = String::new();
        push_json_string(&mut out, "a\"b\\c\n\t\u{1}\u{7f}\u{2028}");
        assert_eq!(out, "\"a\\\"b\\\\c\\n\\t\\u0001\u{7f}\u{2028}\"");
    }

    #[test]
    fn display_matches_render() {
        let mut s = MagicString::new("hello");
        s.overwrite(0, 1, "J").unwrap();
        s.prepend("// ");
        s.append_left(5, "!").unwrap();
        assert_eq!(s.to_string(), s.render());
        assert_eq!(s.render(), "// Jello!");
    }
}
