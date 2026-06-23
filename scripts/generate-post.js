// scripts/generate-post.js
//
// Generates one new German blog article for dienstplan-vergleich.de,
// writes it to /blog/<slug>.html (matching the real site template), and
// updates /blog/index.html (new card + JSON-LD entry + article count).
// Designed to run once per day via GitHub Actions.

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const ROOT = path.join(__dirname, "..");
const BLOG_DIR = path.join(ROOT, "blog");
const BLOG_INDEX = path.join(BLOG_DIR, "index.html");
const PLACEHOLDER_IMAGE = "/blog/images/placeholder-default.svg";
const BASE = "https://www.dienstplan-vergleich.de";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---- helpers ---------------------------------------------------------------

function getExistingPosts() {
  const files = fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".html") && f !== "index.html");

  return files.map((f) => {
    const slug = f.replace(/\.html$/, "");
    const content = fs.readFileSync(path.join(BLOG_DIR, f), "utf-8");
    const titleMatch = content.match(/<title>(.*?)<\/title>/);
    const tagMatch = content.match(/<span class="tag">(.*?)<\/span>/);
    return {
      slug,
      title: titleMatch ? titleMatch[1].trim() : slug,
      tag: tagMatch ? tagMatch[1].trim() : "Ratgeber",
    };
  });
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-").replace(/-+/g, "-");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON string escaping for embedding inside JSON-LD (keeps it valid JSON)
function jsonStr(s) {
  return JSON.stringify(String(s));
}

function germanLongDate(d = new Date()) {
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}
function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// ---- generation ------------------------------------------------------------

async function generateArticle(existingPosts) {
  const existingList = existingPosts.map((p) => `- ${p.title} (${p.tag})`).join("\n");

  const systemPrompt = `Du bist ein erfahrener deutscher B2B-Content-Autor, spezialisiert auf Dienstplanung, Personaleinsatzplanung und Zeiterfassung für KMU. Du schreibst für den Blog von dienstplan-vergleich.de, einer Vergleichsseite, die von Aplano (Anbieter von Dienstplan- und Zeiterfassungssoftware) betrieben wird.

Bereits existierende Artikel (NICHT wiederholen — wähle ein neues, noch nicht behandeltes Thema):
${existingList}

Wähle ein neues, relevantes Thema. Mögliche Richtungen: weitere Branchen (Einzelhandel, Logistik/Lager, Produktion, Call Center, Reinigung, Kita/Bildung, Eventbranche, Bäckerei, Fitnessstudio, Apotheke), weitere Rechtsthemen (Mindestlohn-Dokumentation, Teilzeit- und Befristungsrecht, Schichtzulagen & Nachtzuschläge, Überstundenregelung, Resturlaub & Urlaubsplanung, Arbeitszeitkonten), oder Praxisthemen (Schichtmodelle erklärt, Mitarbeiterbindung durch faire Dienstpläne, Saisonarbeit, Krankheitsausfälle kompensieren, Skill-basierte Einsatzplanung, KI in der Personaleinsatzplanung, Springer-Pools, Dienstplan-Software einführen).

Schreibe sachlich, konkret, mit Zahlen/Beispielen. Erwähne Aplano 1-2 mal natürlich als Lösung (nicht zu werblich). Nutze interne Links im Format <a href="/blog/SLUG.html">Text</a> (nur auf existierende Slugs aus der Liste oben) oder <a href="/#ranking">Gesamtranking</a>.

Rufe das Tool "submit_article" auf, um den Artikel einzureichen. Felder:
- title: SEO-Titel, ca. 50-70 Zeichen
- meta_description: ca. 140-160 Zeichen
- tag: Kurzes Label wie "Branche: Einzelhandel" oder "Recht & Compliance"
- breadcrumb: Kurzer Begriff für die Breadcrumb, z.B. "Einzelhandel"
- read_minutes: Zahl (z.B. 8)
- dek: 1-2 Sätze Einleitung (steht unter dem H1)
- body_html: Vollständiger Artikel-Body als HTML-Fragment. NUR <h2>, <h3>, <p>, <ul>/<li>, <blockquote>, <strong> und <a> verwenden. KEIN H1, KEINE Wrapper, KEINE Bilder. 900-1300 Wörter. Mit mindestens einem <blockquote> mit einer konkreten Zahl/Statistik und mindestens zwei <h2>-Abschnitten.
- cta_heading: Kurze Frage für die CTA-Box
- cta_text: Ein Satz unter der CTA-Überschrift
- faq: 2 Frage/Antwort-Paare
- sources: 2-3 Quellenangaben`;

  const articleSchema = {
    name: "submit_article",
    description: "Submit the generated blog article in structured form.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        meta_description: { type: "string" },
        tag: { type: "string" },
        breadcrumb: { type: "string" },
        read_minutes: { type: "integer" },
        dek: { type: "string" },
        body_html: { type: "string" },
        cta_heading: { type: "string" },
        cta_text: { type: "string" },
        faq: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
            required: ["question", "answer"],
          },
        },
        sources: { type: "array", items: { type: "string" } },
      },
      required: [
        "title", "meta_description", "tag", "breadcrumb", "read_minutes",
        "dek", "body_html", "cta_heading", "cta_text", "faq", "sources",
      ],
    },
  };

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    tools: [articleSchema],
    tool_choice: { type: "tool", name: "submit_article" },
    messages: [{ role: "user", content: `Generiere den heutigen Artikel (Datum: ${germanLongDate()}).` }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use" && b.name === "submit_article");
  if (!toolUse) {
    // Fallback: try to salvage JSON from a text block, in case the model
    // didn't use the tool for some reason.
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("No tool_use or text content in Claude response");
    const raw = textBlock.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(raw);
  }
  return toolUse.input;
}

// ---- HTML building ---------------------------------------------------------

const HEAD_BOILERPLATE = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,450;0,9..144,560;0,9..144,650;1,9..144,450&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2242%22 fill=%22%232D5A4A%22/><path d=%22M50 8 A42 42 0 0 1 50 92 Z%22 fill=%22%23C9A35C%22/><circle cx=%2250%22 cy=%2250%22 r=%2242%22 fill=%22none%22 stroke=%22%23FAFAF8%22 stroke-width=%222%22/><text x=%2248.5%22 y=%2263%22 text-anchor=%22end%22 font-family=%22Georgia, serif%22 font-style=%22italic%22 font-weight=%22700%22 font-size=%2236%22 fill=%22%23FAFAF8%22>d</text><text x=%2251.5%22 y=%2263%22 text-anchor=%22start%22 font-family=%22Georgia, serif%22 font-style=%22italic%22 font-weight=%22700%22 font-size=%2236%22 fill=%22%231F4438%22>v</text></svg>">
<link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%232D5A4A%22/><path d=%22M50 0 A50 50 0 0 1 50 100 L50 0 Z%22 fill=%22%23C9A35C%22/><text x=%2248.5%22 y=%2263%22 text-anchor=%22end%22 font-family=%22Georgia, serif%22 font-style=%22italic%22 font-weight=%22700%22 font-size=%2236%22 fill=%22%23FAFAF8%22>d</text><text x=%2251.5%22 y=%2263%22 text-anchor=%22start%22 font-family=%22Georgia, serif%22 font-style=%22italic%22 font-weight=%22700%22 font-size=%2236%22 fill=%22%231F4438%22>v</text></svg>">
<link rel="stylesheet" href="/style.css">`;

const TOPBAR = `<div class="topbar">
  <div class="wrap">
    <a class="brand" href="/">
      <svg class="brand-mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="42" fill="#2D5A4A"/>
        <path d="M50 8 A42 42 0 0 1 50 92 Z" fill="#C9A35C"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#FAFAF8" stroke-width="2"/>
        <text x="48.5" y="63" text-anchor="end" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="36" fill="#FAFAF8">d</text>
        <text x="51.5" y="63" text-anchor="start" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="36" fill="#1F4438">v</text>
      </svg>
      dienstplan<span class="dot">·</span>vergleich
    </a>
    <nav>
      <a href="/#ranking">Ranking</a>
      <a href="/#methodik">Methodik</a>
      <a href="/blog/" class="active">Blog</a>
      <a href="/ueber-uns.html">Über uns</a>
      <a href="/#faq">FAQ</a>
    </nav>
    <span class="updated-pill">Aktualisiert: Juni 2026</span>
  </div>
</div>`;

const FOOTER = `<footer>
  <div class="wrap">
    <p>© 2026 dienstplan·vergleich — Ein Angebot von Aplano. <a href="/ueber-uns.html">Über uns</a></p>
    <p><a href="/blog/">Zum Blog</a> · <a href="/">Zum Ranking</a></p>
  </div>
</footer>`;

function buildArticleHtml({ article, slug, related }) {
  const url = `${BASE}/blog/${slug}.html`;
  const today = germanLongDate();
  const iso = isoDate();

  const faqDetails = article.faq.map((f, i) => `    <details class="faq-item"${i === 0 ? " open" : ""}>
      <summary>${esc(f.question)}</summary>
      <p>${esc(f.answer)}</p>
    </details>`).join("\n");

  const faqSchema = article.faq.map((f) =>
    `    {"@type":"Question","name":${jsonStr(f.question)},"acceptedAnswer":{"@type":"Answer","text":${jsonStr(f.answer)}}}`
  ).join(",\n");

  const sources = article.sources.map((s) => `        <li>${esc(s)}</li>`).join("\n");

  const relatedCards = related.map((r) =>
    `        <a class="related-card" href="/blog/${r.slug}.html"><span class="tag">${esc(r.tag)}</span><h5>${esc(r.title)}</h5></a>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(article.title)}</title>
<meta name="description" content="${esc(article.meta_description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(article.title)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="de_DE">

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": ${jsonStr(article.title)},
  "description": ${jsonStr(article.meta_description)},
  "datePublished": "${iso}",
  "dateModified": "${iso}",
  "author": {"@type":"Organization","name":"dienstplan-vergleich.de"},
  "publisher": {"@type":"Organization","name":"dienstplan-vergleich.de"},
  "mainEntityOfPage": "${url}"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${faqSchema}
  ]
}
</script>

${HEAD_BOILERPLATE}
</head>
<body>

${TOPBAR}

<div class="wrap breadcrumb">
  <a href="/">Start</a><span class="sep">/</span><a href="/blog/">Blog</a><span class="sep">/</span><span class="current">${esc(article.breadcrumb)}</span>
</div>

<main class="wrap article-shell">
  <div class="article-meta-row">
    <span class="tag">${esc(article.tag)}</span>
    <span>${esc(article.read_minutes)} Min. Lesezeit</span>
    <span>Aktualisiert: ${today}</span>
  </div>
  <h1>${esc(article.title)}</h1>
  <p class="article-dek">${esc(article.dek)}</p>

  <img class="article-hero-img" src="${PLACEHOLDER_IMAGE}" alt="${esc(article.title)}" width="1200" height="499" data-needs-real-image="true">

  <div class="article-body">

${article.body_html}

    <div class="callout-cta">
      <div class="txt">
        <h4>${esc(article.cta_heading)}</h4>
        <p>${esc(article.cta_text)}</p>
      </div>
      <a class="btn" href="/#ranking">Zum Ranking →</a>
    </div>

    <h2>Häufige Fragen</h2>
${faqDetails}

    <div class="sources-box">
      <h4>Quellen</h4>
      <ul>
${sources}
      </ul>
    </div>

    <div class="related-articles">
      <h4>Weiterlesen</h4>
      <div class="related-grid">
${relatedCards}
      </div>
    </div>

  </div>
</main>

${FOOTER}

</body>
</html>
`;
}

// ---- index.html updates ----------------------------------------------------

function updateIndex(article, slug) {
  let html = fs.readFileSync(BLOG_INDEX, "utf-8");

  // 1. New card right after <div class="blog-grid"> (the featured card stays first;
  //    we insert the new card immediately after it would be cleaner, but inserting
  //    at the top of the grid after featured is fine. We insert after the grid opens,
  //    before the featured card, so newest appears first among non-featured? -> To keep
  //    the big featured intro first, insert AFTER the featured card's closing </a>.)
  const card = `
    <a class="blog-card" href="/blog/${slug}.html">
      <span class="tag">${esc(article.tag)}</span>
      <h3>${esc(article.title)}</h3>
      <p>${esc(article.meta_description)}</p>
      <div class="meta"><span>${esc(article.read_minutes)} Min.</span><span>${esc(article.tag.split(":").pop().trim())}</span></div>
    </a>
`;

  // Insert after the first featured card if present, else right after grid opens.
  const featuredClose = html.indexOf("</a>", html.indexOf('class="blog-card featured"'));
  if (html.includes('class="blog-card featured"') && featuredClose !== -1) {
    const insertAt = featuredClose + 4;
    html = html.slice(0, insertAt) + "\n" + card + html.slice(insertAt);
  } else {
    html = html.replace('<div class="blog-grid">', `<div class="blog-grid">\n${card}`);
  }

  // 2. JSON-LD blogPost array: add new entry as first element.
  const newLd = `    {"@type":"BlogPosting","headline":${jsonStr(article.title)},"url":"${BASE}/blog/${slug}.html"},`;
  html = html.replace(/("blogPost":\s*\[\s*)/, `$1\n${newLd}\n`);

  // 3. Eyebrow article count "Ratgeber · N Artikel"
  html = html.replace(/Ratgeber · (\d+) Artikel/, (m, n) => `Ratgeber · ${parseInt(n, 10) + 1} Artikel`);

  fs.writeFileSync(BLOG_INDEX, html, "utf-8");
}

// ---- main ------------------------------------------------------------------

async function main() {
  const existing = getExistingPosts();
  console.log(`Found ${existing.length} existing posts.`);

  const article = await generateArticle(existing);
  console.log(`Generated topic: ${article.title}`);

  let slug = slugify(article.title);
  let filePath = path.join(BLOG_DIR, `${slug}.html`);
  let n = 2;
  while (fs.existsSync(filePath)) {
    slug = `${slugify(article.title)}-${n++}`;
    filePath = path.join(BLOG_DIR, `${slug}.html`);
  }

  const related = [...existing].sort(() => 0.5 - Math.random()).slice(0, 2);
  const html = buildArticleHtml({ article, slug, related });

  fs.writeFileSync(filePath, html, "utf-8");
  console.log(`Wrote ${filePath}`);

  updateIndex(article, slug);
  console.log(`Updated ${BLOG_INDEX}`);
  console.log(`\n>>> NEEDS REAL IMAGE: /blog/${slug}.html (placeholder in use) <<<\n`);
}

main().catch((err) => {
  console.error("Failed to generate post:", err);
  process.exit(1);
});
