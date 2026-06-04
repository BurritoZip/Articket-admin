/** 활성 아티스트 전체 Gemini 보강 1회 드레인 (gemini_checked_at 마커로 한 번씩) */
import { geminiEnrichArtists } from "../../lib/artists/enrich/gemini-enrich";
async function main(){
  let total=0,nm=0;
  for(let i=0;i<60;i++){
    const r=await geminiEnrichArtists({maxItems:40});
    total+=r.filled; nm+=r.notMusic;
    console.log(`배치${i+1}: checked ${r.checked} filled ${r.filled} notMusic ${r.notMusic} (누적 ${total}, 비음악 ${nm})`);
    if(r.checked===0) break;
  }
  console.log(`완료 — 보강 ${total}, 비음악 플래그 ${nm}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
