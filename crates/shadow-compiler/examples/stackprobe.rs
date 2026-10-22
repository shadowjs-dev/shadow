#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::print_stdout
)]
//! Measures how deep nested input may go before the stack runs out: `stackprobe <kind> <depth> <stack KiB>`.
//! Used to choose the nesting guard of the bindings; exits normally when the input compiled.

use shadow_compiler::api::{JsOptions, Outcome, run};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let kind = args.get(1).map_or("paren", String::as_str).to_string();
    let depth: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(100);
    let stack: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(2048);
    let source = match kind.as_str() {
        "paren" => format!("const a = {}1{};", "(".repeat(depth), ")".repeat(depth)),
        "array" => format!("const a = {}1{};", "[".repeat(depth), "]".repeat(depth)),
        "jsx" => format!(
            "const a = {}x{};",
            "<div>".repeat(depth),
            "</div>".repeat(depth)
        ),
        "jsxexpr" => {
            let mut text = String::from("x");
            for _ in 0..depth {
                text = format!("<a b={{{text}}}/>");
            }
            format!("const a = {text};")
        }
        "call" => format!("const a = {}1{};", "f(".repeat(depth), ")".repeat(depth)),
        "member" => format!("const a = x{};", ".y".repeat(depth)),
        "binary" => format!("const a = 1{};", " + 1".repeat(depth)),
        "ternary" => format!("const a = {}1{};", "c ? 1 : ".repeat(depth), ""),
        "arrow" => format!("const a = {}1;", "() => ".repeat(depth)),
        _ => String::new(),
    };
    let source = format!("{source}\nconst z = <a/>;");
    let handle = std::thread::Builder::new()
        .stack_size(stack * 1024)
        .spawn(move || {
            let outcome = run(&source, &JsOptions::default());
            match outcome {
                Outcome::Code { .. } => "code",
                Outcome::Error(_) => "error",
                Outcome::Unsupported(_) => "unsupported",
                Outcome::Internal(_) => "internal",
            }
        })
        .map(std::thread::JoinHandle::join);
    println!("{kind} depth {depth} stack {stack}KiB: {handle:?}");
}
