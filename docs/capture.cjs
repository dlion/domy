const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

(async () => {
  const extension = fs.realpathSync('extension');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  try {
    const id = crypto.createHash('sha256').update(extension).digest('hex').slice(0,32)
      .replace(/./g, digit => String.fromCharCode(97 + parseInt(digit,16)));
    const page = await context.newPage();
    await page.goto('chrome-extension://' + id + '/index.html');
    await page.evaluate(async () => {
      const {access} = await import('./db.js');
      const {collection, makeCard} = await import('./model.js');
      await access(s => {
        for (const [name,color,links] of [
          ['Reading list','Blu',[['A List Apart','alistapart.com'],['The Go Blog','go.dev/blog'],['Domenico Luciani','domenicoluciani.com']]],
          ['Weekend in Málaga','Ambra',[['Museo Picasso Málaga','museopicassomalaga.org'],['Centre Pompidou Málaga','centrepompidou-malaga.eu']]],
          ['Design references','Rosa',[['Typewolf','typewolf.com'],['Awwwards','awwwards.com']]],
        ]) {
          const c = collection(name);
          c.color = color;
          c.cards = links.map(([title,site]) => makeCard('https://' + site,title));
          s.collections.push(c);
        }
        s.view = 'grid';
        s.next = [s.collections[0].cards[1].id];
      });
    });
    await page.reload();
    await page.getByText('3 collections · 7 saved tabs').waitFor();
    await page.getByRole('button',{name:'Awwwards',exact:true}).waitFor();
    await page.screenshot({path:path.resolve('docs/collections.png')});
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
