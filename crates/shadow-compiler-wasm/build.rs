//! Gives the WebAssembly module a 16 MiB stack: the parser recurses on nested input and the default
//! (1 MiB) would trap on deeply nested JSX. Other targets (a host build for the tests) keep the default.

fn main() {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg-cdylib=-zstack-size=16777216");
    }
}
