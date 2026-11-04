/* «Carica slide»: reads a speaker's deck in the browser and fills the talk's
   fields with what Soniox needs to recognise. Nothing is uploaded: .pptx and
   .pdf are opened here, and slides that are only pictures are read by OCR
   running on this computer. The libraries are fetched only when used. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const LIBS = {
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  };
  const loaded = {};
  function script(src) {
    if (!loaded[src]) loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error('Libreria non raggiungibile: controlla la connessione.'));
      document.head.append(s);
    });
    return loaded[src];
  }
  const say = text => { $('slides-status').textContent = text; };

  // ---- Reading ---------------------------------------------------------------
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  async function readPptx(file) {
    await script(LIBS.jszip);
    const zip = await window.JSZip.loadAsync(file);
    const text = async path => (zip.file(path) ? zip.file(path).async('string') : '');
    const rels = await text('ppt/_rels/presentation.xml.rels');
    const target = {};
    for (const m of rels.matchAll(/<Relationship [^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0]); const to = /Target="([^"]+)"/.exec(m[0]);
      if (id && to) target[id[1]] = to[1];
    }
    const order = [...(await text('ppt/presentation.xml')).matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map(m => target[m[1]]);
    const slides = [];
    for (const rel of order) {
      const path = 'ppt/' + rel.replace(/^\//, '');
      const xml = await text(path);
      const lines = [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
        .map(p => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(t => decode(t[1])).join('').trim()).filter(Boolean);
      const slideRels = await text(path.replace('slides/', 'slides/_rels/') + '.rels');
      const media = [...slideRels.matchAll(/Target="\.\.\/media\/([^"]+\.(?:png|jpe?g))"/gi)].map(m => 'ppt/media/' + m[1]);
      slides.push({ lines, picture: media.length ? () => biggest(zip, media) : null });
    }
    return slides;
  }
  async function biggest(zip, paths) {
    let best = null;
    for (const p of paths) {
      const f = zip.file(p); if (!f) continue;
      const blob = await f.async('blob');
      if (!best || blob.size > best.size) best = blob;
    }
    return best;
  }
  async function readPdf(file) {
    await script(LIBS.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const slides = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines = []; let line = ''; let y = null;
      for (const item of content.items) {
        const top = item.transform[5];
        if (y !== null && Math.abs(top - y) > 2) { if (line.trim()) lines.push(line.trim()); line = ''; }
        line += item.str; y = top;
      }
      if (line.trim()) lines.push(line.trim());
      slides.push({ lines, picture: async () => {
        const view = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas'); canvas.width = view.width; canvas.height = view.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
        return canvas;
      } });
    }
    return slides;
  }
  // Slides that carry their words only as a picture are read by OCR.
  async function ocr(slides) {
    const blind = slides.filter(s => s.lines.join(' ').length < 25 && s.picture);
    if (!blind.length) return;
    say('Le slide sono immagini: carico il riconoscimento del testo…');
    await script(LIBS.tesseract);
    const worker = await window.Tesseract.createWorker('eng');
    try {
      for (let i = 0; i < blind.length; i++) {
        say('Riconoscimento del testo nelle immagini: slide ' + (i + 1) + ' di ' + blind.length + '…');
        const source = await blind[i].picture();
        if (!source) continue;
        const { data } = await worker.recognize(await shrink(source));
        blind[i].lines = data.lines.filter(l => l.confidence > 55).map(l => l.text.trim()).filter(l => l.length > 1);
      }
    } finally { await worker.terminate(); }
  }
  // A 4K slide is slower to read and no more accurate than a 2000px one.
  async function shrink(source) {
    const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
    const scale = Math.min(1, 2000 / bitmap.width);
    if (scale === 1 && source instanceof HTMLCanvasElement) return source;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // ---- From text to fields -------------------------------------------------
  // References, links and page furniture say nothing about how the talk sounds.
  const noise = /doi|https?:|www\.|@|et al|\bpp\.|\(\d{4}\)|^\d+([.,]\d+)?$|^[\W\d]+$/i;
  const common = new Set(('The A An And Or Of In On For To From With By At As Is Are Be Our We Why What How When Where Each ' +
    'Most Only All Any This That These Those It Its Not No Yes Data Model Models Results Conclusions Introduction ' +
    'Background Methods Future Thank You Acknowledgments Acknowledgements Session Training Validation Table Figure').split(' '));
  function candidates(lines) {
    const count = new Map();
    const add = (word, weight = 1) => {
      const key = word.toLowerCase();
      const seen = count.get(key);
      count.set(key, { word: seen ? seen.word : word, n: (seen ? seen.n : 0) + weight });
    };
    for (const line of lines) {
      // Acronyms, mixed case and words with digits: names of genes, tools, datasets.
      for (const m of line.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-–][A-Za-z0-9]+)*/g)) {
        const w = m[0];
        // Two letters are a word only as an acronym (AI, ML), never as OCR crumbs.
        if (w.length < 2 || (w.length === 2 && !/^[A-Z]{2}$/.test(w)) || common.has(w)) continue;
        const caps = (w.match(/[A-Z]/g) || []).length;
        if (caps >= 2 || /\d/.test(w) && /[A-Za-z]/.test(w) || /[a-z][A-Z]/.test(w)) add(w);
      }
      // Two or three capitalised words in a row: people, institutes, places.
      for (const m of line.matchAll(/\b[A-ZÀ-Þ][a-zà-ÿ'’]+(?:\s+[A-ZÀ-Þ][a-zà-ÿ'’]+){1,2}\b/g)) {
        const parts = m[0].split(/\s+/);
        if (parts.some(p => common.has(p))) continue;
        add(m[0], 1.5);
      }
    }
    return [...count.values()].sort((a, b) => b.n - a.n).map(c => c.word);
  }
  function apply(slides) {
    const all = [];
    for (const s of slides) for (const l of s.lines) if (!noise.test(l) && !all.includes(l)) all.push(l);
    // Slide titles first: they carry the vocabulary of the whole talk.
    const titles = slides.map(s => s.lines.find(l => !noise.test(l))).filter(Boolean);
    const summary = [...new Set([...titles, ...all])].join('. ').replace(/\.\s*\./g, '.');
    const context = $('context');
    const head = context.value.split('\n\nDalle slide:')[0].trim();
    context.value = (head + '\n\nDalle slide: ' + summary).slice(0, 2500);
    const terms = $('terms');
    const have = terms.value.split('\n').map(t => t.trim()).filter(Boolean);
    const fresh = candidates(all).filter(w => !have.some(h => h.toLowerCase() === w.toLowerCase()));
    let out = have.slice();
    for (const w of fresh) { if ((out.join('\n') + '\n' + w).length > 2000 || out.length >= 80) break; out.push(w); }
    terms.value = out.join('\n');
    return { slides: slides.length, read: slides.filter(s => s.lines.length).length, added: out.length - have.length };
  }

  async function importSlides(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!/\.(pptx|pdf)$/.test(name)) { say('Formato non supportato: usa un file .pptx o .pdf.'); return; }
    $('context-details').open = true;
    say('Lettura di «' + file.name + '»…');
    try {
      const slides = name.endsWith('.pdf') ? await readPdf(file) : await readPptx(file);
      await ocr(slides);
      const r = apply(slides);
      say('Fatto: ' + r.read + ' slide su ' + r.slides + ' lette, ' + r.added + ' parole aggiunte e il testo delle slide nel contesto. ' +
        'Controlla i campi, togli quello che non serve e premi «Salva per questo intervento».');
    } catch (error) {
      say('Non sono riuscito a leggere il file: ' + (error && error.message ? error.message : 'errore sconosciuto') + '.');
    }
  }
  $('slides-file').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    void importSlides(file);
  });
  window.IBSASlides = { importSlides };
})();
