//! Gives the WebAssembly module a 512 MiB stack in its linear memory. The parser recurses on nested input, and the host runs deep
//! input on a thread with a 1 GiB stack of its own (`packages/compiler/src/native/wasm-stack.ts`), as the addon does; the default
//! (1 MiB) would trap on deeply nested JSX. The memory is reserved, not committed, until the stack grows into it. Other targets (a
//! host build for the tests) keep the default.

fn main() {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg-cdylib=-zstack-size=536870912");
    }
}
