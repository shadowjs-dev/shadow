#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::print_stdout
)]
//! A loop for profilers and a quick throughput number: compiles the real components of the parity
//! corpus (`profile [rounds] [ssr]`) and prints the median round time in CPU milliseconds.

use std::io::Read;

use shadow_compiler::compile::{Options, Target, compile};

fn main() {
    let rounds: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);
    let ssr = std::env::args().nth(2).is_some_and(|s| s == "ssr");
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/compiler/test/native/corpus/real.jsonl.gz"
    );
    let mut text = String::new();
    let file = std::fs::File::open(path).expect("corpus");
    flate2::read::GzDecoder::new(file)
        .read_to_string(&mut text)
        .expect("gunzip");
    let mut sources: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let value: serde_json::Value = serde_json::from_str(line).expect("json");
        let options = &value["options"];
        if options.get("generate").is_some()
            || options.get("hmr").is_some()
            || options.get("autoReactive").is_some()
        {
            continue;
        }
        sources.push((
            value["options"]["filename"]
                .as_str()
                .unwrap_or("a.tsx")
                .to_string(),
            value["source"].as_str().unwrap_or("").to_string(),
        ));
    }
    let bytes: usize = sources.iter().map(|s| s.1.len()).sum();
    println!("{} sources, {} bytes", sources.len(), bytes);
    let mode = std::env::args().nth(3).unwrap_or_default();
    let mut times = Vec::new();
    for _ in 0..rounds {
        let started = cpu_ms();
        for (filename, source) in &sources {
            if mode == "parse" || mode == "tree" {
                let allocator = oxc_allocator::Allocator::default();
                let parsed = shadow_compiler::parse::parse(&allocator, source, filename);
                if mode == "tree" {
                    let tree = shadow_compiler::tree::Tree::build(&parsed.program);
                    std::hint::black_box(tree.len());
                }
                std::hint::black_box(&parsed);
                continue;
            }
            let options = Options {
                filename: Some(filename.clone()),
                generate: if ssr { Target::Ssr } else { Target::Dom },
                ..Options::default()
            };
            let _ = std::hint::black_box(compile(source, &options));
        }
        times.push(cpu_ms() - started);
    }
    times.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    println!(
        "median {:.2} ms, min {:.2} ms, max {:.2} ms per round",
        times[times.len() / 2],
        times[0],
        times[times.len() - 1]
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
