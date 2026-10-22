// biome-ignore-all lint/a11y: fixtures check typing of every element; accessibility rules do not apply
// biome-ignore-all lint/correctness/noVoidElementsWithChildren: the void-children cases are negative type tests
/**
 * Type tests: HTML elements and their element-specific attributes. Positive cases must compile; each
 * `@ts-expect-error` must be a real error (an unused directive fails the build).
 *
 * @since 1.0.0
 */
import type { JSX } from "@shadow-js/web/jsx-runtime";
import { sink } from "./support";

/** An element child: valid for normal elements, invalid for text-only ones. */
declare const child: JSX.Element;

// ---- Text and sectioning elements -------------------------------------------------------------
sink(<div />);
sink(<span class="x">text</span>);
sink(
  <p id="intro" lang="en" dir="rtl">
    paragraph
  </p>,
);
sink(<h1 title="main">Title</h1>);
sink(<h2>{"sub"}</h2>);
sink(<h3 />);
sink(<h4 />);
sink(<h5 />);
sink(<h6 />);
sink(
  <header>
    <nav>menu</nav>
  </header>,
);
sink(
  <main>
    <article>
      <section>
        <aside />
      </section>
    </article>
  </main>,
);
sink(<footer hidden="until-found" />);
sink(<address />);
sink(
  <hgroup>
    <h1 />
  </hgroup>,
);
sink(<search role="search" />);
sink(<blockquote cite="https://example.com" />);
sink(<q cite="https://example.com" />);
sink(<pre>{"code"}</pre>);
sink(<em />);
sink(<strong />);
sink(<small />);
sink(<s />);
sink(<cite />);
sink(<dfn />);
sink(<abbr title="Abbreviation" />);
sink(<code />);
sink(<var />);
sink(<samp />);
sink(<kbd />);
sink(<sub />);
sink(<sup />);
sink(<i />);
sink(<b />);
sink(<u />);
sink(<mark />);
sink(<bdi />);
sink(<bdo dir="rtl" />);
sink(
  <ruby>
    <rp />
    <rt />
  </ruby>,
);
sink(<wbr />);
sink(<br />);
sink(<hr />);
sink(<time datetime="2026-01-01" />);
sink(<data value="42" />);

// ---- Links, media, embedded content -----------------------------------------------------------
sink(<a href="/home" target="_blank" rel="noopener" download />);
sink(<a href="/file.pdf" download="report.pdf" hrefLang="en" referrerPolicy="no-referrer" />);
sink(<a href="/x" target="_custom-window" />);
sink(<area alt="map" coords="0,0,10,10" shape="rect" href="/" />);
sink(<img src="/a.png" alt="" width={100} height="50" loading="lazy" decoding="async" />);
sink(
  <img
    src="/a.png"
    srcSet="/a2.png 2x"
    sizes="100vw"
    crossOrigin="anonymous"
    fetchPriority="high"
  />,
);
sink(<img src="/a.png" ismap usemap="#map" referrerpolicy="origin" />);
sink(
  <picture>
    <source srcset="/a.webp" type="image/webp" />
    <img src="/a.png" />
  </picture>,
);
sink(<audio src="/a.mp3" controls autoPlay loop muted preload="metadata" />);
sink(<video src="/v.mp4" poster="/p.jpg" width={640} height={360} playsInline controls />);
sink(
  <video>
    <track kind="captions" src="/c.vtt" srcLang="en" default label="English" />
  </video>,
);
sink(
  <iframe
    src="/embed"
    title="Embed"
    allow="fullscreen"
    allowFullScreen
    loading="lazy"
    sandbox="allow-scripts"
  />,
);
sink(<embed src="/e.swf" type="application/x-shockwave-flash" width={1} height={1} />);
sink(<object data="/o.pdf" type="application/pdf" width={300} />);
sink(<canvas width={300} height={150} />);
sink(
  <map name="m">
    <area alt="a" />
  </map>,
);
sink(<source src="/a.mp3" type="audio/mpeg" media="(min-width: 800px)" />);
sink(<param name="quality" value="high" />);

// ---- Forms ---------------------------------------------------------------------------------------
sink(
  <form
    action="/submit"
    method="post"
    enctype="multipart/form-data"
    autoComplete="off"
    noValidate
  />,
);
sink(<form method="dialog" acceptCharset="utf-8" />);
sink(
  <fieldset disabled name="group">
    <legend>Group</legend>
  </fieldset>,
);
sink(<label htmlFor="name">Name</label>);
sink(<label for="name" />);
sink(
  <output htmlFor="a b" name="result">
    {0}
  </output>,
);
sink(<progress max={100} value={40} />);
sink(<meter min={0} max={10} value={3} low={2} high={8} optimum={5} />);
sink(
  <datalist id="options">
    <option value="a" />
  </datalist>,
);
sink(
  <optgroup label="Group">
    <option value="a" selected>
      A
    </option>
  </optgroup>,
);
sink(
  <option value={1} disabled label="One">
    One
  </option>,
);
sink(
  <select name="choice" multiple required size={3} defaultValue="a" value="a">
    <option value="a" />
  </select>,
);
sink(
  <textarea name="notes" rows={4} cols={40} maxLength={200} readOnly placeholder="Notes">
    {"text"}
  </textarea>,
);
sink(<textarea value={"x"} onInput={(e) => e.currentTarget.value.length} />);
sink(<textarea wrap="soft" minLength={2} defaultValue="x" required />);
sink(
  <button type="submit" name="go" value="1" disabled formAction="/x" formMethod="post">
    Go
  </button>,
);
sink(<button type="reset" formNoValidate popoverTarget="menu" popoverTargetAction="toggle" />);
sink(<button>{() => "dynamic"}</button>);
sink(
  <input type="text" name="q" placeholder="Search" required maxLength={10} autoComplete="off" />,
);
sink(<input type="checkbox" checked defaultChecked indeterminate />);
sink(<input type="radio" name="r" value="a" checked={true} />);
sink(<input type="number" min={0} max="10" step={0.5} value={3} />);
sink(<input type="file" accept="image/*" multiple capture="environment" />);
sink(<input type="date" min="2026-01-01" list="dates" />);
sink(<input type="range" min={0} max={100} />);
sink(<input type="password" readOnly value="" />);
sink(<input type="color" value="#ff0000" />);
sink(<input type="email" formAction="/x" formEncType="text/plain" formTarget="_self" />);
sink(<input value={undefined} />);
sink(<input value={null} />);

// ---- Tables and lists ----------------------------------------------------------------------------
sink(
  <table>
    <caption>Caption</caption>
    <colgroup>
      <col span={2} />
    </colgroup>
  </table>,
);
sink(
  <table>
    <thead>
      <tr>
        <th scope="col" abbr="Name" colSpan={2}>
          Name
        </th>
      </tr>
    </thead>
  </table>,
);
sink(
  <table>
    <tbody>
      <tr>
        <td rowSpan={2} headers="h1" colspan="3">
          cell
        </td>
      </tr>
    </tbody>
  </table>,
);
sink(
  <table>
    <tfoot>
      <tr>
        <th scope="row" rowspan={1} />
      </tr>
    </tfoot>
  </table>,
);
sink(
  <ul>
    <li value={1}>one</li>
  </ul>,
);
sink(
  <ol reversed start={3} type="a">
    <li />
  </ol>,
);
sink(
  <dl>
    <dt>term</dt>
    <dd>definition</dd>
  </dl>,
);
sink(<menu />);

// ---- Interactive, scripting, metadata ------------------------------------------------------------
sink(
  <details open name="faq">
    <summary>More</summary>body
  </details>,
);
sink(
  <dialog open closedby="closerequest">
    dialog
  </dialog>,
);
sink(<slot name="header" />);
sink(
  <template shadowrootmode="open">
    <span />
  </template>,
);
sink(
  <noscript>
    <img src="/x.png" />
  </noscript>,
);
sink(
  <script type="module" src="/main.js" async defer crossOrigin="anonymous" integrity="sha256-x" />,
);
sink(<script>{"console.log(1)"}</script>);
sink(<style media="print">{"body { margin: 0 }"}</style>);
sink(
  <link rel="stylesheet" href="/s.css" media="print" crossOrigin="anonymous" fetchpriority="low" />,
);
sink(<link rel="preload" as="font" href="/f.woff2" type="font/woff2" crossorigin="anonymous" />);
sink(<meta charset="utf-8" />);
sink(<meta name="viewport" content="width=device-width" />);
sink(<meta httpEquiv="refresh" content="5" />);
sink(
  <head>
    <title>Page</title>
  </head>,
);
sink(
  <html lang="en">
    <body />
  </html>,
);
sink(<base href="/" target="_self" />);

// ---- Element-specific negatives ----------------------------------------------------------------
// @ts-expect-error href belongs to a, area, base and link, not div
sink(<div href="/x" />);
// @ts-expect-error void elements have no children
sink(<img src="/a.png">caption</img>);
// @ts-expect-error void elements have no children
sink(<input>text</input>);
// @ts-expect-error br is void
sink(<br>line</br>);
// @ts-expect-error textarea content is text only
sink(<textarea>{child}</textarea>);
// @ts-expect-error option content is text only
sink(<option>{child}</option>);
// @ts-expect-error script content is text only
sink(<script>{child}</script>);
// @ts-expect-error value is text, never a boolean
sink(<input value={true} />);
// @ts-expect-error unknown input type
sink(<input type="nope" />);
// @ts-expect-error unknown button type
sink(<button type="other" />);
// @ts-expect-error form method must be get, post or dialog
sink(<form method="put" />);
// @ts-expect-error target is a string, not a number
sink(<a target={1} />);
// @ts-expect-error img loading is eager or lazy
sink(<img loading="never" />);
// @ts-expect-error ol type is one of 1, a, A, i, I
sink(<ol type="x" />);
// @ts-expect-error th scope is a closed set
sink(<th scope="column" />);
// @ts-expect-error video preload is a closed set
sink(<video preload="always" />);
// @ts-expect-error details open is a boolean
sink(<details open="yes" />);
// @ts-expect-error label for is a string
sink(<label for={1} />);
// @ts-expect-error select value is text, a number or a list of them
sink(<select value={true} />);
sink(<select multiple value={["a", 2]} />);
// @ts-expect-error bdo has no href attribute
sink(<bdo href="/x" />);
// @ts-expect-error unknown attribute on a plain element
sink(<div bogus="x" />);
// @ts-expect-error unknown element tag without a hyphen
sink(<nope />);
// @ts-expect-error sizes is text, not a number
sink(<img sizes={100} />);
// @ts-expect-error dialog closedby is a closed set
sink(<dialog closedby="always" />);
// @ts-expect-error a download is a string or boolean
sink(<a download={{}} />);
// @ts-expect-error a value is text or a number, not an accessor
sink(<input value={() => "x"} />);

export type HtmlElementTypes = JSX.IntrinsicElements;
