//! Conversion between UTF-8 byte offsets (used inside the compiler) and UTF-16 code unit offsets
//! (used by JavaScript strings, diagnostics and source maps).

/// UTF-16 offset of the UTF-8 byte offset `byte` in `source`.
///
/// A `byte` past the end counts the extra bytes one unit each, like a JavaScript offset past the
/// end of a string. A `byte` inside a character counts as the start of that character.
///
/// # Examples
///
/// ```
/// use shadow_compiler::offsets::utf16_offset;
/// assert_eq!(utf16_offset("aé😀b", 1), 1);
/// assert_eq!(utf16_offset("aé😀b", 7), 4);
/// assert_eq!(utf16_offset("ab", 5), 5);
/// ```
#[must_use]
pub fn utf16_offset(source: &str, byte: usize) -> usize {
    if source.is_ascii() {
        return byte;
    }
    let mut units = 0;
    for (index, c) in source.char_indices() {
        if index >= byte {
            return units;
        }
        units += c.len_utf16();
    }
    units + byte.saturating_sub(source.len())
}

/// The UTF-8 byte offset of the UTF-16 offset `unit` in `source`, clamped to the end of the text.
/// An offset inside a surrogate pair counts as the start of the character.
///
/// # Examples
///
/// ```
/// use shadow_compiler::offsets::byte_offset;
/// assert_eq!(byte_offset("aé😀b", 4), 7);
/// ```
#[must_use]
pub fn byte_offset(source: &str, unit: usize) -> usize {
    if source.is_ascii() {
        return unit.min(source.len());
    }
    let mut units = 0;
    for (index, c) in source.char_indices() {
        if units >= unit {
            return index;
        }
        units += c.len_utf16();
    }
    source.len()
}

/// Line starts of a text, for converting offsets to a line and a UTF-16 column.
pub struct LineIndex<'a> {
    source: &'a str,
    starts: Vec<usize>,
}

/// Whether `c` ends a line in ECMAScript: LF, CR, U+2028 and U+2029. A CR that comes right before an
/// LF belongs to the CR LF pair, which the LF ends (`next` is the character after `c`).
#[must_use]
pub fn ends_line(c: char, next: Option<char>) -> bool {
    match c {
        '\n' | '\u{2028}' | '\u{2029}' => true,
        '\r' => next != Some('\n'),
        _ => false,
    }
}

impl<'a> LineIndex<'a> {
    /// Indexes the line starts of `source`: after each LF, lone CR, U+2028 and U+2029.
    #[must_use]
    pub fn new(source: &'a str) -> Self {
        let mut starts = vec![0];
        let mut chars = source.char_indices().peekable();
        while let Some((index, c)) = chars.next() {
            if ends_line(c, chars.peek().map(|&(_, next)| next)) {
                starts.push(index + c.len_utf8());
            }
        }
        LineIndex { source, starts }
    }

    /// The text of the 0-based `line` without its terminator. The CR of a CR LF pair stays: it is a
    /// character of the line it ends, as it is in the column.
    #[must_use]
    pub fn line_text(&self, line: usize) -> &'a str {
        let Some(&start) = self.starts.get(line) else {
            return "";
        };
        let end = self
            .starts
            .get(line + 1)
            .copied()
            .unwrap_or(self.source.len());
        let text = self.source.get(start..end).unwrap_or("");
        match text.chars().next_back() {
            Some(last) if ends_line(last, None) => &text[..text.len() - last.len_utf8()],
            _ => text,
        }
    }

    /// The 1-based line and the 0-based UTF-16 column of the byte offset.
    ///
    /// Like the JavaScript `locate`: a line ends at LF, CR LF, a lone CR, U+2028 or U+2029, and an
    /// offset past the end keeps growing the column of the last line.
    #[must_use]
    pub fn locate(&self, byte: usize) -> (usize, usize) {
        let limit = byte.min(self.source.len());
        let line = match self.starts.binary_search(&limit) {
            Ok(found) => found,
            Err(insert) => insert - 1,
        };
        let line_start = self.starts.get(line).copied().unwrap_or(0);
        let column = utf16_offset(
            self.source.get(line_start..limit).unwrap_or(""),
            limit - line_start,
        ) + byte.saturating_sub(limit);
        (line + 1, column)
    }
}
