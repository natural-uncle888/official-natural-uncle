
document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("news-list");
  const btnLoad = document.getElementById("btn-load");
  const btnExport = document.getElementById("btn-export");
  const btnSave = document.getElementById("btn-save");
  const fileInput = document.getElementById("file-input");

  let newsData = [];

  // 安全地渲染 HTML 內容（移除 script）
  function safeHTML(input) {
    const div = document.createElement("div");
    div.innerHTML = input;
    div.querySelectorAll("script").forEach(e => e.remove());
    return div.innerHTML;
  }

  function renderNewsList() {
    listEl.innerHTML = "";
    const sorted = [...newsData].sort((a, b) => (b.pinned === true) - (a.pinned === true));
    sorted.forEach(item => {
      const card = document.createElement("div");
      card.className = "bg-white p-4 rounded shadow-sm border border-slate-200 space-y-2";

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-xs px-2 py-1 bg-sky-100 text-sky-700 rounded-full">${item.badge || "一般"}</span>
          ${item.pinned ? '<span class="text-red-500 text-xs">📌 置頂</span>' : ""}
        </div>
        <h2 class="text-lg font-bold">${item.title}</h2>
        <div class="text-sm text-slate-500">${item.period || (item.startsAt + " – " + item.endsAt)}</div>
        <div class="text-xs inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700">${item.status || "草稿"}</div>
        <div class="text-sm text-slate-700 line-clamp-3">${safeHTML(item.summary)}</div>
        <ul class="text-sm list-disc list-inside space-y-1">
          ${(item.bullets || []).map(b => "<li>" + safeHTML(b) + "</li>").join("")}
        </ul>
        ${item.cta ? `<a href="${item.cta.link}" target="_blank" class="inline-block mt-2 text-sky-600 hover:underline">${item.cta.text}</a>` : ""}
      `;
      listEl.appendChild(card);
    });
  }

  btnLoad.addEventListener("click", async () => {
    try {
      const res = await fetch("news.json");
      newsData = await res.json();
      renderNewsList();
    } catch (e) {
      alert("載入失敗：請確認 news.json 是否存在於相同目錄");
    }
  });

  fileInput.addEventListener("change", (e) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        newsData = JSON.parse(reader.result);
        renderNewsList();
      } catch (err) {
        alert("JSON 解析錯誤");
      }
    };
    reader.readAsText(e.target.files[0]);
  });

  btnExport.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(newsData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "exported-news.json";
    a.click();
  });

  btnSave.addEventListener("click", () => {
    alert("💡 儲存至 GitHub 功能尚未實作，未來可透過 GitHub API 實現。");
  });
});
