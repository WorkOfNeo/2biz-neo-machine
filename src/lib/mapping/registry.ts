import type { MappingTask } from "./types";

export const mappingRegistry: MappingTask[] = [
  {
    id: "login",
    label: "Login to SpySystem",
    description: "Open login page and submit credentials",
    steps: [
      { name: "goto login", action: { type: "goto", url: "https://2-biz.spysystem.dk/?controller=Index&action=GetLoginPage" } },
      { name: "type username", action: { type: "type", selector: 'input[name="username"]', text: "${env:SPY_USER}", delay: 10 } },
      { name: "type password", action: { type: "type", selector: 'input[name="password"]', text: "${env:SPY_PASS}", delay: 10 } },
      { name: "submit", action: { type: "click", selector: 'button[type="submit"], input[type="submit"]' } },
      { name: "wait", action: { type: "sleep", ms: 500 } },
    ],
  },
  {
    id: "style-list-show-all",
    label: "Style List (Show All)",
    description: "Open Style List with show_all and extract the main table",
    steps: [
      { name: "goto", action: { type: "goto", url: "https://2-biz.spysystem.dk/?controller=Style%5CIndex&action=List&show_all=1" } },
      { name: "wait rows", action: { type: "waitFor", selector: "table.standardList tbody tr", timeoutMs: 30000 } },
      { name: "extract table", action: { type: "extractTable", rootSelector: "table.standardList" } },
    ],
  },
  {
    id: "purchase-running",
    label: "Purchase Running Table",
    description: "Navigate to purchase running and extract table",
    steps: [
      { name: "goto", action: { type: "goto", url: "https://2-biz.spysystem.dk/app/purchase/running" } },
      { name: "wait rows", action: { type: "waitFor", selector: ".app-outlet table tbody tr", timeoutMs: 30000 } },
      { name: "extract table", action: { type: "extractTable", rootSelector: ".app-outlet table" } },
    ],
  },
  {
    id: "sales-running",
    label: "Sales Running Table",
    description: "Navigate to sales running and extract table",
    steps: [
      { name: "goto", action: { type: "goto", url: "https://2-biz.spysystem.dk/app/sales/running" } },
      { name: "wait rows", action: { type: "waitFor", selector: ".app-outlet table tbody tr", timeoutMs: 30000 } },
      { name: "extract table", action: { type: "extractTable", rootSelector: ".app-outlet table" } },
    ],
  },
  {
    id: "statstock-free-from-style",
    label: "Style Stat & Stock (FREE)",
    description: "Open style detail URL and extract FREE section",
    steps: [
      // Accepts param url: the style detail URL
      { name: "goto style", action: { type: "goto", url: "${param:url}#tab=statandstock" } },
      { name: "wait stat", action: { type: "waitFor", selector: ".statAndStockBox", timeoutMs: 30000 } },
      {
        name: "extract FREE",
        action: {
          type: "eval",
          description: "Parse expanded FREE tables (fallback to collapsed)",
          fn: `
          function toNum(s){return parseFloat(String(s||'').replace(/[^0-9.-]/g,''))||0}
          const results = []
          const boxes = Array.from(document.querySelectorAll('.statAndStockBox'))
          for (const box of boxes){
            const details = box.querySelector('.statAndStockDetails')
            if (details){
              const tables = Array.from(details.querySelectorAll('table.tableRadius5.tableBorder'))
              let targetTable=null; let headerRow=null
              for (const tbl of tables){
                const tb = tbl.querySelector('tbody')
                const rows = Array.from(tb?.querySelectorAll('tr')||[])
                if (!rows.length) continue
                const firstBody = rows[1]
                const firstLabel = (firstBody?.querySelector('td')?.innerText||'').trim()
                if (/^free$/i.test(firstLabel)){ targetTable=tbl; headerRow=rows[0]; break }
              }
              if (targetTable && headerRow){
                const headerTds = Array.from(headerRow.querySelectorAll('td'))
                const colorName = (headerTds[0]?.innerText||'').trim().replace(/\s*\n.*/s,'')
                const sizeHeaders=[]
                for (let i=1;i<headerTds.length;i++){ const label=(headerTds[i].innerText||'').trim(); if (/^total$/i.test(label)) break; sizeHeaders.push(label) }
                const tbodyRows = Array.from(targetTable.querySelectorAll('tbody tr'))
                let section='none'; const soldPerSeason=[]; const purchaseTotals=[]; const purchaseOrders=[]; let stock=undefined; let soldStock=undefined;
                const readPerSize=(tds,count)=>tds.slice(1,1+count).map(td=>toNum(td.innerText||''))
                for (const tr of tbodyRows){
                  const tds = Array.from(tr.querySelectorAll('td'))
                  const first = (tds[0]?.innerText||'').trim()
                  if (tr.classList.contains('stylecolor-expanded--header')){
                    const f = first.toLowerCase();
                    if (/^sold$/i.test(first)) section='sold';
                    else if (/^available$/i.test(first)) section='available';
                    else if (/^purchase/i.test(first)) section='purchase';
                    else if (f.includes('net need')) section='net';
                    else section='other';
                    continue
                  }
                  if (section==='none' || section==='other'){
                    // Only capture the first Stock row encountered before entering Sold/Available/Purchase/Net sections
                    if (!stock && /^stock$/i.test(first) && tr.classList.contains('stylecolor-expanded--main')){
                      const perSize=readPerSize(tds,sizeHeaders.length); const total=toNum(tds[1+sizeHeaders.length]?.innerText||''); stock={ perSize, total }
                    }
                  } else if (section==='sold'){
                    // Capture Sold Stock separately
                    if (/^stock$/i.test(first) && tr.classList.contains('stylecolor-expanded--main')){
                      const perSize=readPerSize(tds,sizeHeaders.length); const total=toNum(tds[1+sizeHeaders.length]?.innerText||''); soldStock = { perSize, total };
                      continue;
                    }
                    if (tr.classList.contains('stylecolor-expanded--main')){
                      if (!/^stock$/i.test(first) && !/^total sold$/i.test(first)){
                        const perSize=readPerSize(tds,sizeHeaders.length); const total=toNum(tds[1+sizeHeaders.length]?.innerText||''); soldPerSeason.push({ label:first, perSize, total })
                      }
                    }
                  } else if (section==='purchase'){
                    if (tr.classList.contains('stylecolor-expanded--main')){
                      if (!/^total po/i.test(first)){
                        const perSize=readPerSize(tds,sizeHeaders.length); const total=toNum(tds[1+sizeHeaders.length]?.innerText||''); purchaseTotals.push({ label:first, perSize, total })
                      }
                    } else if (tr.classList.contains('stylecolor-expanded--sub')){
                      const link = tr.querySelector('td a[href]'); const code=(link?.innerText||'').trim(); const href=link?new URL(link.href, location.origin).href:''
                      const etaDiv = tr.querySelector('td .right'); const eta=(etaDiv?.innerText||'').trim() || undefined
                      const perSize=readPerSize(tds,sizeHeaders.length); const total=toNum(tds[1+sizeHeaders.length]?.innerText||'')
                      if (code || href) purchaseOrders.push({ code, href, eta, perSize, total })
                    }
                  } else if (section==='net'){
                    // Ignore Net Need timeline rows for stock calculation
                  }
                }
                results.push({ colorName, sizes:sizeHeaders, stock, soldStock, soldPerSeason, purchaseTotals, purchaseOrders })
              }
            }
          }
          return { ok:true, stat: results }
          `,
        },
      },
    ],
  },
];


