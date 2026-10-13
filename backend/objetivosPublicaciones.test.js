// La misma publicación copiada de dos formas distintas no puede contar dos veces (Fase 3, punto 11 del plan de robustez).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { clavePublicacion } = require("./objetivosActividades");

const iguales = (a, b) => assert.equal(clavePublicacion(a), clavePublicacion(b), `${a} ≠ ${b}`);

test("Facebook: publicación, video, reel, foto y Marketplace por su número", () => {
  iguales("https://www.facebook.com/unisound/posts/123456789", "https://m.facebook.com/permalink.php?story_fbid=123456789&id=55");
  iguales("https://facebook.com/story.php?story_fbid=123456789&id=55", "https://facebook.com/unisound/posts/123456789/?mibextid=x");
  iguales("https://www.facebook.com/groups/999/posts/123456789", "https://facebook.com/groups/otro/permalink/123456789/");
  iguales("https://www.facebook.com/unisound/videos/777", "https://www.facebook.com/watch/?v=777");
  iguales("https://www.facebook.com/reel/777", "https://facebook.com/watch?v=777&ref=sharing");
  iguales("https://www.facebook.com/photo/?fbid=444&set=a.1", "https://facebook.com/photo.php?fbid=444");
  iguales("https://www.facebook.com/marketplace/item/888/", "https://facebook.com/marketplace/item/888?ref=search");
  assert.notEqual(clavePublicacion("https://facebook.com/unisound/posts/1"), clavePublicacion("https://facebook.com/unisound/posts/2"));
  assert.notEqual(clavePublicacion("https://facebook.com/photo.php?fbid=1"), clavePublicacion("https://facebook.com/marketplace/item/1"));
});

test("Instagram, TikTok y YouTube por su código", () => {
  iguales("https://www.instagram.com/p/AbC123/", "https://instagram.com/unisound/p/AbC123?igsh=x");
  iguales("https://www.instagram.com/reel/AbC123/", "https://instagram.com/reels/AbC123");
  iguales("https://www.tiktok.com/@unisound/video/7311", "https://m.tiktok.com/@otra.cuenta/video/7311?is_from_webapp=1");
  iguales("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30", "https://youtu.be/dQw4w9WgXcQ");
  iguales("https://youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.notEqual(clavePublicacion("https://instagram.com/p/AbC123"), clavePublicacion("https://instagram.com/p/abc123"));
});

test("ligas que no se reconocen se comparan normalizadas, como antes", () => {
  iguales("https://www.unisound.mx/blog/guitarras?utm_source=fb", "https://unisound.mx/blog/guitarras/");
  assert.notEqual(clavePublicacion("https://fb.watch/abc"), clavePublicacion("https://fb.watch/xyz"));
  assert.equal(clavePublicacion("no es liga"), "no es liga"); // texto histórico inválido no truena
});
