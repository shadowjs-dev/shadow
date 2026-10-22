#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::print_stdout
)]
//! Compiles one file repeatedly and prints the median CPU time per round: `file <path> [rounds] [ssr] [api]`.

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use shadow_compiler::api::{JsOptions, Outcome, run};
use shadow_compiler::compile::{Options, Target, compile};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("path");
    let rounds: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(30);
    let ssr = args.get(3).is_some_and(|s| s == "ssr");
    let api = args.get(4).is_some_and(|s| s == "api");
    let source = std::fs::read_to_string(path).expect("read");
    let filename = path.rsplit('/').next().unwrap_or("a.jsx").to_string();
    let mut times = Vec::new();
    let mut output_len = 0;
    for _ in 0..rounds {
        let started = cpu_ms();
        if api {
            let options = JsOptions {
                filename: Some(filename.clone()),
                generate: ssr.then(|| "ssr".to_string()),
                ..JsOptions::default()
            };
            if let Outcome::Code { code, .. } = run(&source, &options) {
                output_len = code.len();
            }
        } else {
            let options = Options {
                filename: Some(filename.clone()),
                generate: if ssr { Target::Ssr } else { Target::Dom },
                ..Options::default()
            };
            if let Ok(output) = compile(&source, &options) {
                output_len = output.code.len();
            }
        }
        times.push(cpu_ms() - started);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "{} bytes in, {} bytes out: median {:.2} ms, min {:.2} ms",
        source.len(),
        output_len,
        times[times.len() / 2],
        times[0]
    );
}

fn cpu_ms() -> f64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` fills the struct for the calling process.
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr());
        let usage = usage.assume_init();
        usage.ru_utime.tv_sec as f64 * 1e3
            + usage.ru_utime.tv_usec as f64 / 1e3
            + usage.ru_stime.tv_sec as f64 * 1e3
            + usage.ru_stime.tv_usec as f64 / 1e3
    }
}
