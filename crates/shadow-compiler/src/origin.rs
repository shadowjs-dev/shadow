//! Where the text of a source-to-source pass comes from.
//!
//! The `useStore` pass and the derived-constant pass rewrite the module before the JSX is compiled,
//! and every later stage reads (and reports positions in) the rewritten text. The caller wrote the
//! text before the rewrite, so a position of the rewritten text has to be traced back to it. A pass
//! builds its output as a [`Rope`]: runs of text copied from the text it read, and synthetic runs it
//! wrote itself. The [`Origin`] of that rope answers, for any offset of the new text, the offset of
//! the old text it comes from: exact inside a copied run, the anchor of the run (the place in the old
//! text where the run was written) inside a synthetic one.
//!
//! Ropes count UTF-8 bytes, like the rest of the compiler. An [`Origin`] counts UTF-16 code units, the
//! unit of the positions the compiler reports. The JavaScript compiler (`origin.ts`) does the same
//! with the same rules, so both report the same positions.

use crate::magic::Retrace;

/// A run of a rewritten text: copied from the old text at `from`, or written by the pass at `from`.
#[derive(Debug, Clone, Copy)]
struct Piece {
    /// Length of the run in bytes.
    len: usize,
    /// Byte offset in the old text: where the run is copied from, or where it is anchored.
    from: usize,
    copied: bool,
}

/// A text built from runs of an old text and runs a pass wrote.
#[derive(Debug, Clone, Default)]
pub struct Rope {
    text: String,
    pieces: Vec<Piece>,
    /// Where in the old text the next synthetic run is anchored: the end of the last copy.
    anchor: usize,
}

impl Rope {
    /// An empty rope whose first synthetic run is anchored at the old offset `anchor`.
    #[must_use]
    pub fn new(anchor: usize) -> Self {
        Rope {
            text: String::new(),
            pieces: Vec::new(),
            anchor,
        }
    }

    /// The text built so far.
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    /// The text built so far, by value.
    #[must_use]
    pub fn into_text(self) -> String {
        self.text
    }

    fn push_synthetic(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.text.push_str(text);
        self.pieces.push(Piece {
            len: text.len(),
            from: self.anchor,
            copied: false,
        });
    }

    fn push_copy(&mut self, source: &str, start: usize, end: usize) {
        self.anchor = end;
        if end <= start {
            return;
        }
        self.text.push_str(source.get(start..end).unwrap_or(""));
        self.pieces.push(Piece {
            len: end - start,
            from: start,
            copied: true,
        });
    }

    fn push_rope(&mut self, other: &Rope) {
        self.text.push_str(&other.text);
        self.pieces.extend_from_slice(&other.pieces);
        self.anchor = other.anchor;
    }

    /// Adds a synthetic run, anchored where the rope has reached in the old text.
    #[must_use]
    pub fn write(mut self, text: &str) -> Self {
        self.push_synthetic(text);
        self
    }

    /// Adds the old text from `start` to `end` as it is.
    #[must_use]
    pub fn copy(mut self, source: &str, start: usize, end: usize) -> Self {
        self.push_copy(source, start, end);
        self
    }

    /// Adds another rope; the old text it reached is where this rope has reached now.
    #[must_use]
    pub fn append(mut self, other: &Rope) -> Self {
        self.push_rope(other);
        self
    }

    /// Joins ropes with a synthetic separator.
    #[must_use]
    pub fn join(parts: &[Rope], separator: &str, anchor: usize) -> Rope {
        let mut out = Rope::new(anchor);
        for (index, part) in parts.iter().enumerate() {
            if index > 0 {
                out.push_synthetic(separator);
            }
            out.push_rope(part);
        }
        out
    }
}

/// What replaces the old text of an edit: plain text (anchored at the start of the edit) or a rope.
#[derive(Debug, Clone)]
pub enum EditText {
    /// A synthetic run.
    Text(String),
    /// Copied and synthetic runs.
    Rope(Rope),
}

/// A replacement of the old text from `start` to `end`.
#[derive(Debug, Clone)]
pub struct SpliceEdit {
    /// Where the replaced text starts.
    pub start: usize,
    /// Where the replaced text ends.
    pub end: usize,
    /// The new text.
    pub text: EditText,
}

impl SpliceEdit {
    /// An edit that replaces `start..end` with plain text.
    #[must_use]
    pub fn text(start: usize, end: usize, text: impl Into<String>) -> Self {
        SpliceEdit {
            start,
            end,
            text: EditText::Text(text.into()),
        }
    }

    /// An edit that replaces `start..end` with a rope.
    #[must_use]
    pub fn rope(start: usize, end: usize, rope: Rope) -> Self {
        SpliceEdit {
            start,
            end,
            text: EditText::Rope(rope),
        }
    }
}

/// Applies edits to the old text between `from` and `to`. The edits are in the coordinates of
/// `source`, taken in order of their start (a stable sort); one that starts inside the previous one
/// is skipped.
#[must_use]
pub fn splice<'e>(
    source: &str,
    from: usize,
    to: usize,
    edits: impl IntoIterator<Item = &'e SpliceEdit>,
) -> Rope {
    let mut sorted: Vec<&SpliceEdit> = edits.into_iter().collect();
    sorted.sort_by_key(|edit| edit.start);
    let mut out = Rope::new(from);
    let mut position = from;
    for edit in sorted {
        if edit.start < position {
            continue;
        }
        out.push_copy(source, position, edit.start);
        match &edit.text {
            EditText::Text(text) => out.push_synthetic(text),
            EditText::Rope(rope) => out.push_rope(rope),
        }
        out.anchor = edit.end;
        position = edit.end;
    }
    out.push_copy(source, position, to);
    out.anchor = to;
    out
}

/// Byte offsets to UTF-16 offsets for one text.
struct Units {
    /// True when the text is ASCII: both offsets are the same.
    ascii: bool,
    /// For each character that takes more bytes than UTF-16 units: the byte offset after it and the
    /// bytes in excess of units up to that point.
    marks: Vec<(usize, usize)>,
}

impl Units {
    fn new(text: &str) -> Self {
        if text.is_ascii() {
            return Units {
                ascii: true,
                marks: Vec::new(),
            };
        }
        let mut marks = Vec::new();
        let mut excess = 0;
        for (index, c) in text.char_indices() {
            let extra = c.len_utf8() - c.len_utf16();
            if extra > 0 {
                excess += extra;
                marks.push((index + c.len_utf8(), excess));
            }
        }
        Units {
            ascii: false,
            marks,
        }
    }

    /// The UTF-16 offset of a byte offset that starts a character.
    fn unit(&self, byte: usize) -> usize {
        if self.ascii {
            return byte;
        }
        let at = self.marks.partition_point(|&(after, _)| after <= byte);
        let excess = match at.checked_sub(1).and_then(|i| self.marks.get(i)) {
            Some(&(_, excess)) => excess,
            None => 0,
        };
        byte - excess
    }
}

/// The offsets of a new text traced to the old text it was built from, in UTF-16 code units.
#[derive(Debug, Clone)]
pub struct Origin {
    /// Offset in the new text where each piece starts.
    starts: Vec<usize>,
    /// Offset in the old text each piece is copied from or anchored at.
    from: Vec<usize>,
    /// Whether each piece is copied.
    copied: Vec<bool>,
    /// Length of the new text.
    length: usize,
    /// Length of the old text.
    old_length: usize,
}

impl Origin {
    /// The origin of `rope`, which was built from `old`.
    #[must_use]
    pub fn new(rope: &Rope, old: &str) -> Self {
        let new_units = Units::new(&rope.text);
        let old_units = Units::new(old);
        let mut starts = Vec::with_capacity(rope.pieces.len());
        let mut from = Vec::with_capacity(rope.pieces.len());
        let mut copied = Vec::with_capacity(rope.pieces.len());
        let mut cursor = 0;
        for piece in &rope.pieces {
            starts.push(new_units.unit(cursor));
            from.push(old_units.unit(piece.from));
            copied.push(piece.copied);
            cursor += piece.len;
        }
        Origin {
            starts,
            from,
            copied,
            length: new_units.unit(rope.text.len()),
            old_length: old_units.unit(old.len()),
        }
    }

    /// The index of the piece that holds `offset` (the last one that starts at or before it).
    fn piece_at(&self, offset: usize) -> Option<usize> {
        self.starts
            .partition_point(|&start| start <= offset)
            .checked_sub(1)
    }

    fn start_of(&self, piece: usize) -> usize {
        self.starts.get(piece).copied().unwrap_or(0)
    }

    fn end_of(&self, piece: usize) -> usize {
        self.starts.get(piece + 1).copied().unwrap_or(self.length)
    }

    /// The offset of the old text for an offset of the new one (where a position starts).
    #[must_use]
    pub fn to_old_start(&self, offset: usize) -> usize {
        if offset >= self.length {
            return self.old_length + (offset - self.length);
        }
        let Some(piece) = self.piece_at(offset) else {
            return offset;
        };
        let from = self.from.get(piece).copied().unwrap_or(0);
        if self.copied.get(piece).copied().unwrap_or(false) {
            from + (offset - self.start_of(piece))
        } else {
            from
        }
    }

    /// The offset of the old text for an offset of the new one that ends a range (exclusive): the end
    /// of the last character the range holds, when that character was copied.
    #[must_use]
    pub fn to_old_end(&self, offset: usize) -> usize {
        if offset > 0
            && offset <= self.length
            && let Some(piece) = self.piece_at(offset - 1)
            && self.copied.get(piece).copied().unwrap_or(false)
        {
            return self.from.get(piece).copied().unwrap_or(0) + (offset - self.start_of(piece));
        }
        self.to_old_start(offset)
    }
}

/// Traces an offset of the text after the passes back to the text before them. `chain` holds the
/// origins of the passes in the order they ran.
#[must_use]
pub fn trace_start(chain: &[Origin], offset: usize) -> usize {
    chain
        .iter()
        .rev()
        .fold(offset, |at, origin| origin.to_old_start(at))
}

/// Like [`trace_start`], for the end of a range.
#[must_use]
pub fn trace_end(chain: &[Origin], offset: usize) -> usize {
    chain
        .iter()
        .rev()
        .fold(offset, |at, origin| origin.to_old_end(at))
}

/// Offset in UTF-16 code units where each line of a text starts.
fn line_starts(text: &str) -> Vec<usize> {
    let mut starts = vec![0];
    if text.is_ascii() {
        starts.extend(text.match_indices('\n').map(|(index, _)| index + 1));
        return starts;
    }
    let mut units = 0;
    let mut line_start = 0;
    for (index, _) in text.match_indices('\n') {
        units += text
            .get(line_start..=index)
            .map_or(0, |line| line.encode_utf16().count());
        line_start = index + 1;
        starts.push(units);
    }
    starts
}

/// The line that holds an offset: the last entry of `starts` that is at or before it.
fn line_of(starts: &[usize], offset: usize) -> usize {
    starts
        .partition_point(|&start| start <= offset)
        .saturating_sub(1)
}

/// Points the positions of a source map of the rewritten text at the text as it was written.
pub struct Retracer<'a> {
    chain: &'a [Origin],
    /// Where the lines of the rewritten text start.
    from_lines: Vec<usize>,
    /// Where the lines of the module as it was written start.
    to_lines: Vec<usize>,
    /// The piece found last, per origin: the next lookup usually hits it or the one after.
    hints: Vec<usize>,
}

impl<'a> Retracer<'a> {
    /// A retracer for a map of `rewritten` (the text after the passes in `chain`) that has to point
    /// into `source` (the text before them).
    #[must_use]
    pub fn new(chain: &'a [Origin], rewritten: &str, source: &str) -> Self {
        Retracer {
            chain,
            from_lines: line_starts(rewritten),
            to_lines: line_starts(source),
            hints: vec![0; chain.len()],
        }
    }

    fn locate(&self, offset: usize) -> (usize, usize) {
        let line = line_of(&self.to_lines, offset);
        (line, offset - self.to_lines.get(line).copied().unwrap_or(0))
    }

    fn offset_of(&self, line: usize, column: usize) -> usize {
        self.from_lines.get(line).copied().unwrap_or(0) + column
    }
}

impl Retrace for Retracer<'_> {
    fn point(&mut self, line: usize, column: usize) -> (usize, usize) {
        let at = trace_start(self.chain, self.offset_of(line, column));
        self.locate(at)
    }

    fn run(&mut self, line: usize, column: usize, len: usize) -> Option<(usize, usize)> {
        let mut at = self.offset_of(line, column);
        for (level, origin) in self.chain.iter().enumerate().rev() {
            let hint = self.hints.get(level).copied().unwrap_or(0);
            let piece = if origin.starts.get(hint).is_some_and(|&start| start <= at)
                && at < origin.end_of(hint)
            {
                hint
            } else if origin
                .starts
                .get(hint + 1)
                .is_some_and(|&start| start <= at)
                && at < origin.end_of(hint + 1)
            {
                hint + 1
            } else {
                origin.piece_at(at)?
            };
            if let Some(slot) = self.hints.get_mut(level) {
                *slot = piece;
            }
            // The whole run has to lie in one copied piece to move as one.
            if !origin.copied.get(piece).copied().unwrap_or(false)
                || at + len > origin.end_of(piece)
            {
                return None;
            }
            at = origin.from.get(piece).copied().unwrap_or(0) + (at - origin.start_of(piece));
        }
        Some(self.locate(at))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin_of(old: &str, edits: &[SpliceEdit]) -> (String, Origin) {
        let rope = splice(old, 0, old.len(), edits);
        let origin = Origin::new(&rope, old);
        (rope.into_text(), origin)
    }

    #[test]
    fn copied_text_maps_exactly_and_inserted_text_to_its_anchor() {
        let old = "aaa bbb ccc";
        let (new, origin) = origin_of(
            old,
            &[
                SpliceEdit::text(0, 0, "import x;\n"),
                SpliceEdit::text(4, 7, "BBBBB"),
            ],
        );
        assert_eq!(new, "import x;\naaa BBBBB ccc");
        assert_eq!(origin.to_old_start(10), 0);
        assert_eq!(origin.to_old_start(12), 2);
        assert_eq!(origin.to_old_start(14), 4);
        assert_eq!(origin.to_old_start(17), 4);
        assert_eq!(origin.to_old_start(19), 7);
        assert_eq!(origin.to_old_start(22), 10);
        assert_eq!(origin.to_old_start(23), 11);
        assert_eq!(origin.to_old_end(13), 3);
        assert_eq!(origin.to_old_end(19), 7);
    }

    #[test]
    fn units_are_utf16() {
        let old = "\u{1F600}a\u{e9}b";
        let (new, origin) = origin_of(old, &[SpliceEdit::text(5, 5, "XY")]);
        assert_eq!(new, "\u{1F600}aXY\u{e9}b");
        // 😀 is two units, a one, X and Y two, é one.
        assert_eq!(origin.to_old_start(3), 3);
        assert_eq!(origin.to_old_start(4), 3);
        assert_eq!(origin.to_old_start(5), 3);
        assert_eq!(origin.to_old_start(6), 4);
    }

    #[test]
    fn a_rope_moves_copied_text_out_of_order() {
        let old = "(a = 1, b) => 0";
        let moved = Rope::new(7).write("const a = (").copy(old, 5, 6).write(")");
        let (new, origin) = origin_of(
            old,
            &[
                SpliceEdit::text(0, 10, "_p"),
                SpliceEdit::rope(15, 15, moved),
            ],
        );
        assert_eq!(new, "_p => 0const a = (1)");
        assert_eq!(origin.to_old_start(18), 5);
        assert_eq!(origin.to_old_end(19), 6);
    }
}
