/** What the server project renders for the NoHydration page; [NOH-04] pins this string to the real server output. */
export const SERVER_HTML =
  '<main data-hk="0-0-0" class="page"><h1><!--[-->Guide<!--]--></h1><!--[--><!--nh:0-0-1-0--><article class="prose"><p>Long static body</p></article><!--/nh--><!--]--><footer><!--[-->Guide<!--]--></footer></main>';

/** The same article passed through a layout's children; [NOH-06] pins this string to the real server output. */
export const LAYOUT_HTML =
  '<div data-hk="0-0-0-0" class="layout"><nav>nav</nav><!--[--><!--nh:0-0-0-1-0--><article class="prose"><p>Long static body</p></article><!--/nh--><!--]--></div>';
