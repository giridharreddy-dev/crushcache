import {readFile,writeFile,mkdir} from 'node:fs/promises';
let html=await readFile('index.html','utf8');
html=html.replace('<html lang="en">','<html lang="en" data-hosting="browser-only">')
 .replace('https://crushcache.netlify.app','https://giridharreddy-dev.github.io/crushcache/')
 .replace('Enter your name and your crush\'s name to discover your true flame connection. Get a magical love percentage based on FLAMES + cosmic energy!','A browser-only entertainment demo. Names stay in this tab; FLAMES scores are just a game, not a relationship prediction.')
 .replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/,'$1<p style="font-size:.78rem;line-height:1.7;margin:14px 0;padding:12px;background:#fff8;border-radius:10px">Browser-only demo · use nicknames. Names are not sent to a server. Scores are for entertainment, not relationship predictions.</p>')
 .replace('Please enter real names (2–100 letters, no numbers)','Use nicknames or sample names (2–100 letters)');
html=html.replace('💖 LoveLeak – Love Meter','CrushCache — Browser-only entertainment demo')
 .replace('🔥 Trending now: Sneha ❤️ Rahul = 99%','Example only: Sneha ❤️ Rahul = 99%')
 .replace('✨ Love note saved in the universe ✨','Browser-only entertainment demo')
 .replace('🔥 Ready to measure love 🔥','Browser demo · no submissions collected')
 .replace('based on ancient FLAMES & cosmic vibrations • pure heart meter','FLAMES-inspired entertainment • scores do not predict relationships');
if(!html.includes('data-hosting="browser-only"'))throw new Error('Browser demo marker missing.');
await mkdir('dist-pages',{recursive:true});
await writeFile('dist-pages/index.html',html);await writeFile('dist-pages/.nojekyll','');
console.log('Built browser-only entertainment demo. Netlify/Airtable/Redis are not deployed.');
