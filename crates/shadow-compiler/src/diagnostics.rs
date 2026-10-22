//! Located problems in a source module, in the form the JavaScript compiler reports them.

use crate::error::Fail;
use crate::offsets::{LineIndex, utf16_offset};
use crate::origin::{Origin, trace_end, trace_start};

/// A located problem in a source module. Offsets count UTF-16 code units, like string indexes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Stable identifier of the problem, such as `PARSE_ERROR` or `INVALID_HTML_NESTING`.
    pub code: String,
    /// Human-readable explanation, without the position.
    pub message: String,
    /// UTF-16 offset in the source where the problem starts.
    pub start: usize,
    /// UTF-16 offset in the source where the problem ends (exclusive).
    pub end: usize,
    /// 1-based line of `start`.
    pub line: usize,
    /// 0-based column of `start`, counted from the start of its line.
    pub column: usize,
}

/// What the compiler throws for source it cannot or refuses to transform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompileError {
    /// The problem.
    pub diagnostic: Diagnostic,
    /// Source excerpt of the offending line with a caret under the column, ready to print.
    pub frame: String,
    /// The file name the module was compiled with.
    pub id: String,
}

impl CompileError {
    /// The message of the error: `<id>:<line>:<column> <code>: <message>` and the frame.
    #[must_use]
    pub fn message(&self) -> String {
        format!(
            "{}:{}:{} {}: {}\n{}",
            self.id,
            self.diagnostic.line,
            self.diagnostic.column,
            self.diagnostic.code,
            self.diagnostic.message,
            self.frame
        )
    }
}

/// Builds the printable excerpt of the line holding the byte offset `start`: the line number and the
/// line, then a second line with a caret under the column.
#[must_use]
pub fn code_frame(source: &str, start: usize) -> String {
    let index = LineIndex::new(source);
    let (line, column) = index.locate(start);
    frame_at(source, line, column)
}

/// The excerpt of the 1-based `line` with a caret under the 0-based `column`.
fn frame_at(source: &str, line: usize, column: usize) -> String {
    let text = source.split('\n').nth(line - 1).unwrap_or("");
    format!("{line:>4} | {text}\n     | {}^", " ".repeat(column))
}

/// The 1-based line and the 0-based column of a UTF-16 offset, like the JavaScript `locate`: only
/// `\n` ends a line, and an offset past the end keeps growing the column of the last line.
fn locate_utf16(source: &str, offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut line_start = 0;
    let mut units = 0;
    for c in source.chars() {
        if units >= offset {
            break;
        }
        units += c.len_utf16();
        if c == '\n' {
            line += 1;
            line_start = units;
        }
    }
    (line, offset - line_start)
}

/// Converts a failure of a pass over `text` into the error the JavaScript compiler throws.
#[must_use]
pub fn to_compile_error(text: &str, fail: &Fail, id: &str) -> CompileError {
    let start = fail.start as usize;
    let index = LineIndex::new(text);
    let (line, column) = index.locate(start);
    let start16 = utf16_offset(text, start);
    let end16 = match fail.end {
        Some(end) => utf16_offset(text, end as usize),
        None => start16 + 1,
    };
    CompileError {
        diagnostic: Diagnostic {
            code: fail.code.to_string(),
            message: fail.message.clone(),
            start: start16,
            end: end16,
            line,
            column,
        },
        frame: code_frame(text, start),
        id: id.to_string(),
    }
}

/// Converts a failure of a pass over `text`, a rewrite of the module `source`, into the error the
/// JavaScript compiler throws: the positions are traced back through the rewrites in `chain` (in the
/// order they ran) and are those of `source`, with the code frame of `source`. With no rewrite this is
/// [`to_compile_error`].
#[must_use]
pub fn to_compile_error_in(
    source: &str,
    text: &str,
    fail: &Fail,
    id: &str,
    chain: &[Origin],
) -> CompileError {
    if chain.is_empty() {
        return to_compile_error(text, fail, id);
    }
    let start16 = utf16_offset(text, fail.start as usize);
    let end16 = match fail.end {
        Some(end) => utf16_offset(text, end as usize),
        None => start16 + 1,
    };
    let start = trace_start(chain, start16);
    let end = trace_end(chain, end16).max(start);
    let (line, column) = locate_utf16(source, start);
    CompileError {
        diagnostic: Diagnostic {
            code: fail.code.to_string(),
            message: fail.message.clone(),
            start,
            end,
            line,
            column,
        },
        frame: frame_at(source, line, column),
        id: id.to_string(),
    }
}
