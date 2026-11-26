const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

(async () => {
  const extension = fs.realpathSync('extension');
  const launch = () => chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  let context = await launch();
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
    if (process.argv.includes('--test-backup')) {
      const assert = require('node:assert/strict');
      await page.evaluate(async () => {
        const {access} = await import('./db.js');
        const {completeNext, makeCard} = await import('./model.js');
        await access(s => {
          completeNext(s,s.next[0],12345);
          const c=s.collections[0], original=c.cards[0];
          original.tags=['reference'];
          s.next.push(original.id);
          s.collections[1].cards.push(makeCard(original.url,'Another copy'));
          s.trash.push({kind:'card',value:c.cards.pop(),index:2,parent:c.id,parentName:c.name});
        });
      });
      const readState = p => p.evaluate(async () => (await import('./db.js')).access());
      const expected = await readState(page);
      await page.getByText('Import & backup',{exact:true}).click();
      const download = page.waitForEvent('download');
      await page.getByRole('button',{name:'Export backup'}).click();
      const backup = path.join(process.env.RUNNER_TEMP,'workspace.json');
      await (await download).saveAs(backup);
      await context.close();
      context = await launch();
      const target = await context.newPage();
      await target.goto('chrome-extension://' + id + '/index.html');
      await target.getByText('0 collections · 0 saved tabs').waitFor();
      await target.getByText('Import & backup',{exact:true}).click();
      const chooser = target.waitForEvent('filechooser');
      await target.getByRole('button',{name:'Restore backup'}).click();
      await (await chooser).setFiles(backup);
      await target.getByRole('button',{name:'Restore',exact:true}).click();
      await target.getByText('3 collections · 7 saved tabs').waitFor();
      assert.deepEqual(await readState(target), expected);
    }
  } finally {
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
