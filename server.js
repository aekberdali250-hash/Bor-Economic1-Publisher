const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const CRON_SECRET = process.env.CRON_SECRET || "";
const PAGE_ID = process.env.FACEBOOK_PAGE_ID || "";
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";
const TIME_ZONE = "Africa/Algiers";
const START_DATE = process.env.PUBLISH_START_DATE || "";

const posts = JSON.parse(fs.readFileSync(path.join(__dirname, "posts.json"), "utf8"));

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function getPostForDate(dateString) {
  if (!START_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) {
    throw new Error("Set PUBLISH_START_DATE in YYYY-MM-DD format.");
  }
  const start = new Date(`${START_DATE}T12:00:00Z`);
  const current = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) {
    throw new Error("Invalid publication date.");
  }
  const dayOffset = Math.floor((current - start) / 86400000);
  if (dayOffset < 0) {
    return { index: null, post: null, dayOffset };
  }
  const index = dayOffset % posts.length;
  return { index, post: posts[index], dayOffset };
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bor Economic Publisher</title>
  <body style="font-family:Arial;max-width:760px;margin:35px auto;padding:0 16px;line-height:1.8">
  <h1>ناشر Bor الاقتصادي</h1>
  <p>هذه خدمة مستقلة لتجربة نشر أربعة مقالات اقتصادية على صفحة فيسبوك.</p>
  <p><a href="/api/health">فحص الخدمة</a> · <a href="/api/preview">معاينة مقال اليوم</a></p>
  <p>النشر الفعلي يحتاج إعداد أسرار Meta وGitHub Actions كما هو موضح في README.</p>
  </body></html>`);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Bor Economic Publisher",
    articles: posts.length,
    timezone: TIME_ZONE,
    startDateConfigured: Boolean(START_DATE),
    facebookConfigured: Boolean(PAGE_ID && PAGE_ACCESS_TOKEN),
    cronSecretConfigured: Boolean(CRON_SECRET)
  });
});

app.get("/api/preview", (_req, res) => {
  try {
    const today = localDateString();
    const result = getPostForDate(today);
    if (!result.post) {
      return res.json({ ok: true, today, message: "Publication cycle has not started yet.", articleCount: posts.length });
    }
    res.json({
      ok: true,
      today,
      timezone: TIME_ZONE,
      articleNumber: result.index + 1,
      articleCount: posts.length,
      title: result.post.title,
      message: result.post.message
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/publish", async (req, res) => {
  const providedSecret = req.get("x-cron-secret") || "";
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized. Check CRON_SECRET." });
  }

  try {
    if (!PAGE_ID || !PAGE_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: "Facebook credentials are not configured." });
    }

    const today = localDateString();
    const result = getPostForDate(today);
    if (!result.post) {
      return res.status(409).json({ ok: false, today, error: "Publication start date is in the future." });
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(PAGE_ID)}/feed`;
    const form = new URLSearchParams({
      message: result.post.message,
      access_token: PAGE_ACCESS_TOKEN
    });

    const fbResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    const fbData = await fbResponse.json();

    if (!fbResponse.ok || fbData.error) {
      console.error("Meta publish failed:", JSON.stringify(fbData));
      return res.status(502).json({
        ok: false,
        today,
        articleNumber: result.index + 1,
        title: result.post.title,
        error: fbData.error?.message || "Meta API rejected the post.",
        metaErrorCode: fbData.error?.code || null
      });
    }

    console.log(`Published article ${result.index + 1}/${posts.length} for ${today}; post id: ${fbData.id}`);
    return res.json({
      ok: true,
      today,
      timezone: TIME_ZONE,
      articleNumber: result.index + 1,
      articleCount: posts.length,
      title: result.post.title,
      facebookPostId: fbData.id
    });
  } catch (err) {
    console.error("Publish error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Unexpected server error." });
  }
});

app.listen(PORT, () => console.log(`Bor Economic Publisher listening on ${PORT}`));
