//! The ShadowJS JSX compiler.
//!
//! A Rust port of the TypeScript compiler `@shadow-js/compiler`: it parses a module with oxc, lowers
//! each JSX tree to an intermediate form and rewrites the JSX in place into calls to the ShadowJS
//! runtime. The output is byte-identical to the reference compiler.

pub mod api;
pub mod bindings;
pub mod classify;
pub mod compile;
pub mod ctx;
pub mod derive;
pub mod diagnostics;
pub mod dom;
pub mod entities;
pub mod error;
pub mod fxhash;
pub mod hmr;
pub mod ir;
pub mod jsutil;
mod kinds;
pub mod lower;
pub mod magic;
pub mod names;
pub mod nesting;
pub mod offsets;
pub mod origin;
pub mod parse;
pub mod registry;
pub mod ssr;
pub mod store_cells;
pub mod text;
pub mod tree;
