#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::print_stdout
)]
//! Times the stages of the pipeline over the real components of the parity corpus
//! (`phases [rounds]`). It repeats the steps of `compile::compile` with a timer around each.

#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::io::Read;
use std::time::{Duration, Instant};

use oxc_allocator::Allocator;
use shadow_compiler::bindings::unassignable_names;
use shadow_compiler::ctx::{Ctx, CtxSettings};
use shadow_compiler::derive::derive_locals;
use shadow_compiler::fxhash::FxHashSet;
use shadow_compiler::magic::MagicString;
use shadow_compiler::parse::parse_module;
use shadow_compiler::registry::Registry;
use shadow_compiler::store_cells::specialize_store_cells;
use shadow_compiler::tree::{Tree, Ty};

fn main() {
    let rounds: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30);
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/compiler/test/native/corpus/real.jsonl.gz"
    );
    let mut text = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).expect("corpus"))
        .read_to_string(&mut text)
        .expect("gunzip");
    let mut sources: Vec<(String, String)> = Vec::new();
    let single = std::env::args().nth(2);
    if let Some(path) = &single {
        sources.push((
            "a.jsx".to_string(),
            std::fs::read_to_string(path).expect("read"),
        ));
    }
    for line in text.lines().filter(|_| single.is_none()) {
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
    let names = [
        "cells",
        "parse1",
        "tree1",
        "derive",
        "parse2+tree2",
        "taken+roots",
        "unassignable",
        "place (lower+gen)",
        "magic overwrite",
        "prelude+epilogue",
        "render",
        "map",
    ];
    let mut totals = vec![Duration::ZERO; names.len()];
    for round in 0..rounds {
        let mut round_totals = vec![Duration::ZERO; names.len()];
        for (filename, source) in &sources {
            let mut mark = Instant::now();
            let mut lap = |slot: usize, round_totals: &mut Vec<Duration>| {
                let now = Instant::now();
                round_totals[slot] += now - mark;
                mark = now;
            };
            let Ok(cells) = specialize_store_cells(source, filename) else {
                continue;
            };
            lap(0, &mut round_totals);
            let first_allocator = Allocator::default();
            let Ok(first) = parse_module(&first_allocator, &cells.code, filename) else {
                continue;
            };
            lap(1, &mut round_totals);
            let first_tree = Tree::build(&first.program);
            lap(2, &mut round_totals);
            let Ok(derived) =
                derive_locals(&cells.code, &first_tree, &first.program, "@shadow-js/web")
            else {
                continue;
            };
            lap(3, &mut round_totals);
            let second_allocator = Allocator::default();
            let second;
            let second_tree;
            let (input, _program, tree): (&str, &oxc_ast::ast::Program<'_>, &Tree<'_>) =
                if let Some(rope) = &derived {
                    second =
                        parse_module(&second_allocator, rope.text(), filename).expect("reparse");
                    second_tree = Tree::build(&second.program);
                    (rope.text(), &second.program, &second_tree)
                } else {
                    (cells.code.as_str(), &first.program, &first_tree)
                };
            lap(4, &mut round_totals);
            let mut taken: FxHashSet<String> = FxHashSet::default();
            let mut roots = Vec::new();
            tree.walk(0, |node, _| {
                if matches!(tree.ty(node), Ty::Identifier | Ty::JSXIdentifier)
                    && let Some(name) = tree.name(node)
                    && (name.starts_with('_') || name.starts_with('$'))
                {
                    taken.insert(name.to_string());
                }
                if tree.ty(node).is_jsx() {
                    roots.push(node);
                    return false;
                }
                true
            });
            lap(5, &mut round_totals);
            let immutable = unassignable_names(tree);
            std::hint::black_box(&immutable);
            lap(6, &mut round_totals);
            let registry = Registry::new(taken, "@shadow-js/web".to_string());
            let settings = CtxSettings {
                ssr: false,
                dev: false,
                hydratable: true,
            };
            let mut ctx = Ctx::new(input, filename, tree, registry, &settings);
            let mut placed_all = Vec::new();
            for root in roots {
                let site = ctx.site_of(root, 0);
                if let Ok(placed) = ctx.place(&site) {
                    placed_all.push(placed);
                }
            }
            lap(7, &mut round_totals);
            let mut magic = MagicString::new(input);
            for placed in placed_all {
                let _ = magic.overwrite(placed.start as usize, placed.end as usize, placed.text);
            }
            lap(8, &mut round_totals);
            let epilogue = ctx.reg.epilogue();
            let prelude = ctx.reg.prelude();
            if !prelude.is_empty() {
                magic.prepend(&prelude);
            }
            if !epilogue.is_empty() {
                magic.append(&epilogue);
            }
            lap(9, &mut round_totals);
            let rendered = magic.render();
            std::hint::black_box(&rendered);
            lap(10, &mut round_totals);
            let map = magic.generate_map(Some(filename), false);
            std::hint::black_box(&map);
            lap(11, &mut round_totals);
        }
        if round >= rounds / 2 {
            for (total, value) in totals.iter_mut().zip(&round_totals) {
                *total += *value;
            }
        }
    }
    let measured = (rounds - rounds / 2) as u32;
    let sum: Duration = totals.iter().sum();
    for (name, total) in names.iter().zip(&totals) {
        println!(
            "{name:>20}: {:7.2} ms  {:5.1}%",
            total.as_secs_f64() * 1e3 / f64::from(measured),
            100.0 * total.as_secs_f64() / sum.as_secs_f64()
        );
    }
    println!(
        "{:>20}: {:7.2} ms",
        "total",
        sum.as_secs_f64() * 1e3 / f64::from(measured)
    );
}
