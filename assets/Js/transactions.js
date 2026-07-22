/* Tactile press feedback via scale. */
document.querySelectorAll('button').forEach(function (btn) {
  btn.addEventListener('mousedown', function () { btn.style.transform = 'scale(0.96)'; });
  btn.addEventListener('mouseup', function () { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('mouseleave', function () { btn.style.transform = 'scale(1)'; });
});

/* ============================================================
   Filtering, live search & export.
   Operates only on the rows already in the DOM; no data changes.
   ============================================================ */
(function () {
  "use strict";

  var body = document.getElementById('tx-body');
  if (!body) return;

  var rows = [];
  var typeFilter = document.getElementById('type-filter');
  var categoryFilter = document.getElementById('category-filter');
  var dateFrom = document.getElementById('date-from');
  var dateTo = document.getElementById('date-to');
  var applyBtn = document.getElementById('apply-filters');
  var resetBtn = document.getElementById('reset-filters');
  var search = document.getElementById('tx-search');
  var searchClear = document.getElementById('tx-search-clear');
  var visibleCountEl = document.getElementById('tx-visible-count');
  var totalCountEl = document.getElementById('tx-total-count');

  var state = { type: 'all', category: 'all', from: '', to: '', q: '' };

  // ---- Pagination state ----
  // Filtering decides which rows *qualify*; pagination then shows only the
  // current page's slice of those. New pages appear automatically as the
  // qualifying count grows. Any filter/search change resets to page 1.
  var PER_PAGE = 10;
  var currentPage = 1;
  var pager = document.getElementById('tx-pagination');

  // (Re)build the row cache from the DOM. Runs on load and whenever the
  // shared store injects or removes saved-transaction rows, so filtering,
  // search and counts stay correct after a delete.
  function cacheRows() {
    rows = Array.prototype.slice.call(body.querySelectorAll('tr[data-tx]'));
    if (totalCountEl) totalCountEl.textContent = String(rows.length);
    rows.forEach(function (row) {
      row._text = (row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      row._type = (row.getAttribute('data-type') || '').toLowerCase();
      row._category = (row.getAttribute('data-category') || '').toLowerCase();
      row._date = row.getAttribute('data-date') || '';
    });
  }
  cacheRows();

  function matches(row) {
    if (state.type !== 'all' && row._type !== state.type) return false;
    if (state.category !== 'all' && row._category !== state.category) return false;
    if (state.from && row._date && row._date < state.from) return false;
    if (state.to && row._date && row._date > state.to) return false;
    if (state.q) {
      var terms = state.q.split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) {
        if (row._text.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  function render() {
    // 1) Which rows qualify under the active filters + search.
    var matched = rows.filter(matches);

    // 2) Clamp the current page to the new page count (e.g. after a delete
    //    or a filter change shrinks the set) so we never land on an empty page.
    var totalPages = Math.max(1, Math.ceil(matched.length / PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    // 3) Show only this page's slice; hide everything else (non-matching rows
    //    stay hidden too).
    var start = (currentPage - 1) * PER_PAGE;
    var end = start + PER_PAGE;
    var shownOnPage = 0;
    rows.forEach(function (row) { row.hidden = true; });
    matched.forEach(function (row, i) {
      var onPage = i >= start && i < end;
      row.hidden = !onPage;
      if (onPage) shownOnPage++;
    });

    // "Showing X of Y" — X is what's on this page, Y is the full match count.
    if (visibleCountEl) visibleCountEl.textContent = String(shownOnPage);
    if (totalCountEl) totalCountEl.textContent = String(matched.length);

    renderEmpty(matched.length);
    renderPager(matched.length, totalPages);
  }

  function renderPager(matchedCount, totalPages) {
    if (!pager || !window.FinwisePagination) return;
    FinwisePagination.render(pager, {
      total: matchedCount,
      perPage: PER_PAGE,
      current: currentPage,
      onGo: function (page) {
        currentPage = page;
        render();
        // Bring the table back into view when paging on a long page.
        var section = pager.closest('section');
        if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Filters/search changed the result set — always return to the first page.
  function resetPage() { currentPage = 1; }

  // Empty-state row, created lazily so we never touch the original markup.
  var emptyRow = null;
  function renderEmpty(visible) {
    if (visible > 0) { if (emptyRow) emptyRow.hidden = true; return; }
    if (!emptyRow) {
      emptyRow = document.createElement('tr');
      var td = document.createElement('td');
      td.setAttribute('colspan', '6');
      td.className = 'text-center muted';
      td.style.padding = 'var(--sp-7)';
      var icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.style.cssText = 'font-size:32px;display:block;margin-bottom:8px;opacity:.5';
      icon.textContent = 'search_off';
      td.appendChild(icon);
      td.appendChild(document.createTextNode('No transactions match your filters.'));
      emptyRow.appendChild(td);
      body.appendChild(emptyRow);
    }
    emptyRow.hidden = false;
  }

  // ---- Type segmented control ----
  if (typeFilter) {
    typeFilter.addEventListener('click', function (e) {
      var btn = e.target.closest('.segmented__btn');
      if (!btn) return;
      typeFilter.querySelectorAll('.segmented__btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.type = (btn.getAttribute('data-type') || 'all').toLowerCase();
      resetPage();
      render();
    });
  }

  // ---- Category / date change immediately; Apply is also honored ----
  function syncFromInputs() {
    if (categoryFilter) state.category = (categoryFilter.value || 'all').toLowerCase();
    if (dateFrom) state.from = dateFrom.value || '';
    if (dateTo) state.to = dateTo.value || '';
  }
  if (categoryFilter) categoryFilter.addEventListener('change', function () { syncFromInputs(); resetPage(); render(); });
  if (dateFrom) dateFrom.addEventListener('change', function () { syncFromInputs(); resetPage(); render(); });
  if (dateTo) dateTo.addEventListener('change', function () { syncFromInputs(); resetPage(); render(); });
  if (applyBtn) applyBtn.addEventListener('click', function () { syncFromInputs(); resetPage(); render(); });

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      state = { type: 'all', category: 'all', from: '', to: '', q: '' };
      if (categoryFilter) categoryFilter.value = 'all';
      if (dateFrom) dateFrom.value = '';
      if (dateTo) dateTo.value = '';
      if (search) search.value = '';
      if (searchClear) searchClear.hidden = true;
      if (typeFilter) {
        typeFilter.querySelectorAll('.segmented__btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-type') === 'all');
        });
      }
      resetPage();
      render();
    });
  }

  // ---- Live search ----
  if (search) {
    search.addEventListener('input', function () {
      state.q = search.value.trim().toLowerCase();
      if (searchClear) searchClear.hidden = search.value === '';
      resetPage();
      render();
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', function () {
      search.value = '';
      state.q = '';
      searchClear.hidden = true;
      search.focus();
      resetPage();
      render();
    });
  }

  // ============================================================
  //  Export — builds files from the CURRENTLY VISIBLE rows so
  //  exports respect active filters & search.
  // ============================================================
  var COLUMNS = ['Date', 'Description', 'Category', 'Type', 'Amount'];

  function visibleRows() {
    // Rows matching the active filters/search — across ALL pages, not just the
    // current page's slice. Pagination only limits what's on screen; an export
    // should still cover every matching transaction.
    return rows.filter(matches);
  }

  function rowToRecord(row) {
    var cells = row.querySelectorAll('td');
    // cells: [date, description, category, type, amount, action]
    var descEl = cells[1];
    var descMain = descEl.querySelector('p') ? descEl.querySelector('p').textContent.trim() : descEl.textContent.trim();
    return [
      cells[0].textContent.trim(),
      descMain,
      cells[2].textContent.replace(/\s+/g, ' ').trim(),
      cells[3].textContent.trim(),
      cells[4].textContent.trim()
    ];
  }

  function currentRecords() {
    return visibleRows().map(rowToRecord);
  }

  function download(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function toast(msg) {
    if (window.showToast) window.showToast(msg, 'success');
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function csvEscape(v) {
    v = String(v == null ? '' : v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function buildCSV(records) {
    var lines = [COLUMNS.map(csvEscape).join(',')];
    records.forEach(function (rec) { lines.push(rec.map(csvEscape).join(',')); });
    return lines.join('\r\n');
  }

  function exportCSV() {
    var records = currentRecords();
    if (!records.length) return toast('Nothing to export');
    download('transactions.csv', 'text/csv;charset=utf-8;', '﻿' + buildCSV(records));
    toast('Exported ' + records.length + ' transactions to CSV');
  }

  // Excel: an .xls file using an HTML table is opened natively by Excel.
  function exportExcel() {
    var records = currentRecords();
    if (!records.length) return toast('Nothing to export');
    var head = '<tr>' + COLUMNS.map(function (c) { return '<th>' + esc(c) + '<\/th>'; }).join('') + '<\/tr>';
    var bodyHtml = records.map(function (rec) {
      return '<tr>' + rec.map(function (c) { return '<td>' + esc(c) + '<\/td>'; }).join('') + '<\/tr>';
    }).join('');
    var html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"\/><\/head>'
      + '<body><table border="1">' + head + bodyHtml + '<\/table><\/body><\/html>';
    download('transactions.xls', 'application/vnd.ms-excel;charset=utf-8;', html);
    toast('Exported ' + records.length + ' transactions to Excel');
  }

  // Locate the jsPDF constructor across the UMD/global variations.
  function getJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  // PDF: build a real PDF with jsPDF and download it automatically — no
  // print/save dialog. Falls back to silent iframe-print only if the jsPDF
  // library failed to load (e.g. offline / CDN blocked).
  function exportPDF() {
    var records = currentRecords();
    if (!records.length) return toast('Nothing to export');

    var JsPDF = getJsPDF();
    if (!JsPDF) return exportPDFViaPrint(records);

    var doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('FINWISE - Transaction History', 40, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(92, 107, 109);
    doc.text(records.length + ' transactions', 40, 62);

    if (typeof doc.autoTable === 'function') {
      doc.autoTable({
        head: [COLUMNS],
        body: records,
        startY: 78,
        margin: { left: 40, right: 40 },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [28, 43, 45] },
        headStyles: { fillColor: [118, 171, 174], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [247, 249, 249] },
        columnStyles: { 4: { halign: 'right', font: 'courier' } }
      });
    } else {
      // autoTable plugin missing: render a simple manual table.
      var y = 92;
      doc.setFontSize(9);
      records.forEach(function (rec) {
        doc.text(rec.join('   |   '), 40, y);
        y += 16;
        if (y > 540) { doc.addPage(); y = 40; }
      });
    }

    doc.save('transactions.pdf');
    toast('Exported ' + records.length + ' transactions to PDF');
  }

  // Fallback: render into a hidden same-origin iframe and print silently.
  function exportPDFViaPrint(records) {
    var head = '<tr>' + COLUMNS.map(function (c) { return '<th>' + esc(c) + '<\/th>'; }).join('') + '<\/tr>';
    var bodyHtml = records.map(function (rec) {
      return '<tr>' + rec.map(function (c, i) {
        var cls = i === 4 ? ' class="amt"' : '';
        return '<td' + cls + '>' + esc(c) + '<\/td>';
      }).join('') + '<\/tr>';
    }).join('');

    var docHtml =
      '<!DOCTYPE html><html><head><meta charset="utf-8"\/><title>FINWISE — Transactions<\/title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;color:#1c2b2d;padding:32px}'
      + 'h1{font-size:20px;margin:0 0 4px}p.sub{color:#5c6b6d;margin:0 0 20px;font-size:13px}'
      + 'table{width:100%;border-collapse:collapse;font-size:13px}'
      + 'th,td{border:1px solid #e3e9e9;padding:8px 10px;text-align:left}'
      + 'th{background:#f1f7f7;text-transform:uppercase;font-size:11px;letter-spacing:.05em}'
      + 'td.amt{text-align:right;font-family:monospace}<\/style><\/head><body>'
      + '<h1>FINWISE — Transaction History<\/h1>'
      + '<p class="sub">' + records.length + ' transactions<\/p>'
      + '<table>' + head + bodyHtml + '<\/table><\/body><\/html>';

    var iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    var idoc = iframe.contentWindow.document;
    idoc.open();
    idoc.write(docHtml);
    idoc.close();

    setTimeout(function () {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        toast('Could not open the print dialog');
      }
      setTimeout(function () { iframe.remove(); }, 1000);
    }, 300);

    toast('Preparing PDF for ' + records.length + ' transactions');
  }

  // ---- Delete a transaction ----
  // Delegated so it covers both the static demo rows and rows injected by
  // the shared store. Saved rows carry a data-id and are purged from
  // localStorage via the store; demo rows are just removed from the DOM.
  function performDelete(row) {
    var id = row.getAttribute('data-id');
    if (id && window.FinwiseStore && typeof FinwiseStore.remove === 'function') {
      // Store.remove broadcasts finwise:change; the store re-renders the
      // injected rows and our listener below re-caches + re-renders.
      if (FinwiseStore.remove(id)) {
        if (window.showToast) showToast('Transaction deleted', 'success');
        return;
      }
    }
    // Static/demo row (no id) — remove directly and refresh the view.
    row.remove();
    cacheRows();
    render();
    if (window.showToast) showToast('Transaction deleted', 'success');
  }

  // View receipt — delegated so it covers store-injected rows. Looks the
  // receipt up from the store by row id and opens it in the shared lightbox.
  body.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-receipt]');
    if (!btn || !body.contains(btn)) return;
    var row = btn.closest('tr[data-tx]');
    var id = row && row.getAttribute('data-id');
    var tx = (id && window.FinwiseStore && FinwiseStore.get) ? FinwiseStore.get(id) : null;
    if (tx && tx.receipt) {
      if (window.finwiseViewReceipt) window.finwiseViewReceipt(tx.receipt);
    } else if (window.showToast) {
      showToast('No receipt attached to this transaction', 'info');
    }
  });

  body.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-delete]');
    if (!btn || !body.contains(btn)) return;
    var row = btn.closest('tr[data-tx]');
    if (!row) return;

    // Label the row in the confirmation for clarity.
    var descCell = row.querySelectorAll('td')[1];
    var desc = descCell
      ? (descCell.querySelector('p') ? descCell.querySelector('p').textContent.trim() : descCell.textContent.trim())
      : '';
    var message = desc
      ? '“' + desc + '” will be permanently removed. This can’t be undone.'
      : 'This transaction will be permanently removed. This can’t be undone.';

    if (typeof window.finwiseConfirm === 'function') {
      window.finwiseConfirm({
        title: 'Delete transaction?',
        message: message,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        tone: 'danger',
        icon: 'delete'
      }).then(function (ok) { if (ok) performDelete(row); });
    } else if (window.confirm('Delete this transaction?')) {
      performDelete(row);
    }
  });

  // Keep the cache in sync when the store injects/removes saved rows.
  window.addEventListener('finwise:change', function () { cacheRows(); render(); });

  var csvBtn = document.getElementById('export-csv');
  var excelBtn = document.getElementById('export-excel');
  var pdfBtn = document.getElementById('export-pdf');
  var allBtn = document.getElementById('export-all');
  if (csvBtn) csvBtn.addEventListener('click', exportCSV);
  if (excelBtn) excelBtn.addEventListener('click', exportExcel);
  if (pdfBtn) pdfBtn.addEventListener('click', exportPDF);
  // "Export All": ignore active filters and export every loaded row as CSV.
  if (allBtn) {
    allBtn.addEventListener('click', function () {
      var records = rows.map(rowToRecord);
      download('transactions-all.csv', 'text/csv;charset=utf-8;', '﻿' + buildCSV(records));
      toast('Exported all ' + records.length + ' transactions');
    });
  }

  render();
})();
