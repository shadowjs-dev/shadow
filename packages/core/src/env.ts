/**
 * True in the server condition build, where effects never run and rendering produces strings. Use
 * it to skip browser-only work. The value is fixed per build: the package export conditions
 * (`node`, `worker`, `browser`, ...) choose the build, not a runtime check.
 *
 * @example
 * import { isServer } from "@shadow-js/core";
 *
 * const width = isServer ? 1024 : window.innerWidth;
 * @see isDev
 * @since 1.0.0
 */
export const isServer: boolean = __SERVER__;

/**
 * True in development builds; false in production builds where `__DEV__` is compiled away. The
 * `development` export condition selects the development build. Use it to guard checks and logging
 * meant for development only.
 *
 * @example
 * import { isDev } from "@shadow-js/core";
 *
 * if (isDev) console.info("debug panel enabled");
 * @see isServer
 * @since 1.0.0
 */
export const isDev: boolean = __DEV__;
