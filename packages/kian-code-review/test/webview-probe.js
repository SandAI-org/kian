  window.addEventListener('message', event => {
    if (event.data?.type !== 'probe') return;
    const action = event.data.action;
    if (action === 'expand') expand.click();
    if (action === 'collapse') collapse.click();
    if (action === 'hide-details' && !detailsHidden || action === 'show-details' && detailsHidden) detailToggle.click();
    if (action === 'filter' || action === 'clear-filter') {
      fileSearch.value = action === 'filter' ? 'demo.py' : '';
      fileSearch.dispatchEvent(new Event('input'));
    }
    if (action === 'select-commit') historyBody.querySelector('.commit-row').click();
    if (action === 'pending-mode') mode.value = 'commit';
    api.postMessage({ type: 'probe-result', id: event.data.id,
      files: filesBody.querySelectorAll('.file-row').length, commits: historyBody.querySelectorAll('.commit-row').length,
      selected: historyBody.querySelectorAll('.selected').length, controls: controls.querySelectorAll('button.control').length,
      folders: filesBody.querySelectorAll('details').length, openFolders: filesBody.querySelectorAll('details[open]').length,
      detailsHidden, previousDisabled: previous.disabled, nextDisabled: next.disabled,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      injectedElements: app.querySelectorAll('img, iframe').length,
      layoutDisplay: getComputedStyle(layout).display, toolbarDisplay: getComputedStyle(header).display,
      modeValue: mode.value, busy, statusText: status.textContent,
    });
  });
