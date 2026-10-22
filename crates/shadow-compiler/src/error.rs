//! Failures of the compiler passes.

/// A problem in the source, with the code and the message the reference compiler uses.
///
/// Offsets are UTF-8 byte offsets into the text the failing pass was reading; the driver converts
/// them to UTF-16 offsets of that text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    /// Stable identifier such as `INVALID_HTML_NESTING`.
    pub code: &'static str,
    /// Human-readable explanation, without the position.
    pub message: String,
    /// Where the problem starts.
    pub start: u32,
    /// Where the problem ends; `None` means one UTF-16 unit after `start`.
    pub end: Option<u32>,
}

/// Why a pass stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// The source cannot be compiled; the reference compiler throws a `CompileError`.
    Error(Fail),
    /// The input needs something this implementation does not reproduce byte for byte (a string
    /// with a lone surrogate, nesting deeper than the stack allows). The caller must use the
    /// reference compiler for this input.
    Unsupported(String),
}

/// Result of a compiler pass.
pub type Result<T> = std::result::Result<T, Failure>;

/// A failure at the node starting at `start` and ending at `end`.
pub fn fail_span<T>(
    code: &'static str,
    message: impl Into<String>,
    start: u32,
    end: u32,
) -> Result<T> {
    Err(Failure::Error(Fail {
        code,
        message: message.into(),
        start,
        end: Some(end),
    }))
}

/// A failure at `start`; the reported end is one UTF-16 unit after it.
pub fn fail_at<T>(code: &'static str, message: impl Into<String>, start: u32) -> Result<T> {
    Err(Failure::Error(Fail {
        code,
        message: message.into(),
        start,
        end: None,
    }))
}

/// An input this implementation hands to the reference compiler.
pub fn unsupported<T>(reason: impl Into<String>) -> Result<T> {
    Err(Failure::Unsupported(reason.into()))
}
