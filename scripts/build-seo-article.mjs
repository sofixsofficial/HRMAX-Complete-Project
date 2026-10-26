/**
 * Builds the standalone SEO article page from the authored source HTML.
 *
 * The source file has its <title>/fonts in the BODY, no lang attribute, no
 * description/canonical/Open Graph, and a non-standard charset token — all of
 * which hurt crawlability. This script keeps the article body and CSS
 * byte-for-byte but rewrites a standards-compliant, SEO-complete <head>.
 *
 * Run: node scripts/build-seo-article.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = 'C:/Users/azayy/Downloads/HR MAX by Sofixs.html'

const ORIGIN = 'https://www.hrmax.in'
const PATH = '/hr-max-by-sofixs-hr-payroll-management.html'
const URL = `${ORIGIN}${PATH}`
// Output filename MUST match PATH — CloudFront serves the object that exists,
// so a mismatch silently falls back to the SPA shell.
const OUT = join(__dirname, '..', 'frontend', 'public', PATH.replace(/^\//, ''))

const raw = readFileSync(SRC, 'utf8')

// The source ships an editorial "Publishing details" checklist (SEO title,
// slug, pre-publish notes) inside a <details>. That is authoring metadata,
// never meant for visitors — strip it before publishing.
const sanitized = raw.replace(/<details>[\s\S]*?Publishing details[\s\S]*?<\/details>/i, '')

// The authored file: <body> -> <title> -> <meta> -> <font link> -> <style> -> content
const fontLink = (sanitized.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [])[0] ?? ''
const bigStyle = sanitized.match(/<style>\s*\/\* Layout:[\s\S]*?<\/style>/)
if (!bigStyle) throw new Error('could not locate the article stylesheet')
const css = bigStyle[0]
// Everything after the stylesheet is the article markup. The source already
// ends with </body></html>, which must be stripped before we re-wrap it.
const bodyContent = sanitized
  .slice(bigStyle.index + bigStyle[0].length)
  .replace(/<\/body>[\s\S]*?<\/html>\s*$/i, '')
  .trim()

// SEO title/description: the author recorded these in "Publishing details".
const TITLE = 'HR MAX by Sofixs: Modern HR and Payroll Management Software'
const DESCRIPTION =
  'Discover HR MAX by Sofixs, a modern HR management platform for employee records, ' +
  'attendance, leave, payroll, permissions and reporting.'

const articleLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'HR MAX by Sofixs: A Smarter Way to Manage People, Payroll, and Business Growth',
  description: DESCRIPTION,
  datePublished: '2026-10-26',
  dateModified: '2026-10-26',
  inLanguage: 'en-IN',
  mainEntityOfPage: URL,
  image: `${ORIGIN}/og-image.png`,
  author: { '@type': 'Organization', name: 'Sofixs', url: 'https://www.sofixs.com/' },
  publisher: {
    '@type': 'Organization',
    name: 'HR MAX by Sofixs',
    url: ORIGIN,
    logo: { '@type': 'ImageObject', url: `${ORIGIN}/og-image.png` },
  },
  keywords: 'HR management software, HRMS, employee management, attendance software, leave management, payroll software',
}

const breadcrumbLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
    { '@type': 'ListItem', position: 2, name: 'HR MAX by Sofixs', item: URL },
  ],
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="author" content="Sofixs">
<link rel="canonical" href="${URL}">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:site_name" content="HR MAX">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${URL}">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<meta property="og:image:alt" content="HR MAX logo">
<meta property="article:published_time" content="2026-10-26">
<meta property="article:modified_time" content="2026-10-26">
<meta property="article:author" content="Sofixs">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${ORIGIN}/og-image.png">

<script type="application/ld+json">
${JSON.stringify(articleLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(breadcrumbLd, null, 2)}
</script>
${fontLink}
${css}
</head>
<body>
${bodyContent}
</body>
</html>
`

writeFileSync(OUT, html, 'utf8')
console.log('written:', OUT)
console.log('bytes:', Buffer.byteLength(html, 'utf8'))
