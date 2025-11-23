/* script.js
   Handles preview rendering, photo upload, page size/margin toggles, and PDF export via html2pdf.
*/

(function () {
  const bioText = document.getElementById('bioText');
  const photoInput = document.getElementById('photo');
  const previewPhoto = document.getElementById('previewPhoto');
  const previewContent = document.getElementById('previewContent');
  const previewName = document.getElementById('previewName');
  const nameInput = document.getElementById('nameInput');
  const previewBtn = document.getElementById('previewBtn');
  const exportPdfBtn = document.getElementById('exportPdfBtn');
  const clearBtn = document.getElementById('clearBtn');
  const pageSizeSelect = document.getElementById('pageSize');
  const pageMarginSelect = document.getElementById('pageMargin');
  const guidesToggle = document.getElementById('guidesToggle');

  const printArea = document.getElementById('printArea');
  const previewHolder = document.getElementById('previewHolder');

  // Load image file into previewPhoto
  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) {
      previewPhoto.src = '';
      previewPhoto.alt = 'photo preview';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      previewPhoto.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // Update preview content
  function updatePreview() {
    // Name
    const name = (nameInput.value || '').trim();
    previewName.textContent = name || 'Name';

    // Content (preserve paragraphs)
    const text = bioText.value || '';
    // Very light sanitization: escape HTML
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    previewContent.innerHTML = escaped.replace(/\n{2,}/g, '\n\n').replace(/\n/g, '<br />');

    // Page size classes
    printArea.classList.toggle('a4', pageSizeSelect.value === 'a4');
    printArea.classList.toggle('letter', pageSizeSelect.value === 'letter');

    renderPageGuides();
  }

  // Simple page guide calculation: determine when content exceeds a page and add guides.
  function renderPageGuides() {
    // Remove existing guides
    const existing = printArea.querySelectorAll('.page-guide');
    existing.forEach(n => n.remove());

    if (!guidesToggle.checked) return;

    // We'll measure the content height and add guide lines at multiples of page height (content area)
    const pageHeight = printArea.clientHeight;
    const contentHeight = printArea.scrollHeight;

    // If content is within one page, nothing to do
    if (contentHeight <= pageHeight) return;

    const pages = Math.ceil(contentHeight / pageHeight);
    for (let i = 1; i < pages; i++) {
      const guide = document.createElement('div');
      guide.className = 'page-guide';
      guide.style.top = `${i * pageHeight - 1}px`;
      printArea.appendChild(guide);
    }
  }

  previewBtn.addEventListener('click', updatePreview);
  pageSizeSelect.addEventListener('change', updatePreview);
  guidesToggle.addEventListener('change', updatePreview);

  clearBtn.addEventListener('click', () => {
    bioText.value = '';
    nameInput.value = '';
    photoInput.value = '';
    previewPhoto.src = '';
    previewContent.innerHTML = '';
    previewName.textContent = 'Name';
    renderPageGuides();
  });

  // Export PDF using html2pdf. We convert mm margins to px-ish via selected page size.
  exportPdfBtn.addEventListener('click', async () => {
    updatePreview(); // ensure current content is rendered

    const pageSize = pageSizeSelect.value === 'a4' ? 'a4' : 'letter';
    const marginMm = parseInt(pageMarginSelect.value, 10) || 15;

    // html2pdf options
    const opt = {
      margin: (marginMm / 25.4), // html2pdf expects inches if using 'mm' not used, convert to inches
      filename: `${(nameInput.value || 'physician-bio').replace(/\s+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: pageSize, orientation: 'portrait' }
    };

    // Create a clone of the printArea so we can remove guides and set proper size
    const clone = printArea.cloneNode(true);
    // remove guides
    clone.querySelectorAll('.page-guide').forEach(n => n.remove());

    // wrap clone in a container for html2pdf
    const container = document.createElement('div');
    container.style.background = '#fff';
    container.appendChild(clone);

    try {
      await html2pdf().set(opt).from(container).save();
    } catch (err) {
      console.error('Export failed', err);
      alert('PDF export failed. See console for details.');
    }
  });

  // Initialize from any default content
  updatePreview();

  // Recompute guides when window resizes (so guide positions stay accurate)
  window.addEventListener('resize', () => {
    // small debounce
    clearTimeout(window.__preview_resize_timeout__);
    window.__preview_resize_timeout__ = setTimeout(renderPageGuides, 120);
  });
})();