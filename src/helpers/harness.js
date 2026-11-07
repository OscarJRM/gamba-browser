/**
 * gamba-browser - Autonomous Harness Helpers
 * 
 * Reusable, framework-agnostic utilities for modern web automation (React, Vue, Svelte, Angular, Vanilla).
 * Solves:
 * 1. Controlled SPA inputs reverting values (smartFill).
 * 2. Disabled buttons with no clear DOM reason (explainDisabled via React Fiber & WAI-ARIA).
 * 3. Split-buttons and dropdown collisions (clickPrimary).
 * 4. Tab management over persistent CDP (getOrCreateTab).
 */

/**
 * Deep diagnostic tool for disabled, unclickable or blocked buttons.
 * Inspects WAI-ARIA states, HTML5 constraints, and descends the React Fiber component
 * tree to extract validation errors, error codes, and disabled reasons.
 * 
 * @param {import('playwright').Page} page
 * @param {string} selectorOrText - Selector or visible text of the button
 */
async function explainDisabled(page, selectorOrText) {
  return await page.evaluate((target) => {
    let el = null;
    try {
      el = document.querySelector(target);
    } catch (e) {
      // Target was text, not a valid CSS selector
    }

    if (!el) {
      // Find by button, link, role or tag matching text or aria-label
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], a, input[type="submit"], [role="tab"], [role="menuitem"]'));
      el = candidates.find(b => {
        const text = b.innerText?.trim().toLowerCase() || '';
        const label = b.getAttribute('aria-label')?.toLowerCase() || '';
        const t = target.toLowerCase();
        return text.includes(t) || label.includes(t);
      });
    }

    if (!el) {
      // Deep fallback: find any text node matching target and find its closest clickable parent
      const all = Array.from(document.querySelectorAll('*'));
      const textMatch = all.find(e => e.innerText && e.innerText.trim().toLowerCase().includes(target.toLowerCase()) && e.children.length === 0);
      if (textMatch) {
        el = textMatch.closest('button, div[role="button"], a, [role="tab"]') || textMatch;
      }
    }

    if (!el) {
      return {
        found: false,
        error: `No button or clickable element found matching: "${target}"`
      };
    }

    const ariaDisabled = el.getAttribute('aria-disabled') === 'true';
    const htmlDisabled = el.disabled === true;
    const isPointerEventsNone = window.getComputedStyle(el).pointerEvents === 'none';
    const rect = el.getBoundingClientRect();
    const isZeroSize = rect.width === 0 || rect.height === 0;

    // Check if covered by another overlay
    let coveredBy = null;
    if (rect.width > 0 && rect.height > 0) {
      const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (topElement && topElement !== el && !el.contains(topElement)) {
        coveredBy = {
          tagName: topElement.tagName,
          className: topElement.className,
          textSnippet: topElement.innerText?.slice(0, 50)
        };
      }
    }

    // Inspect Tooltips / WAI-ARIA description
    let ariaDescription = null;
    const describedById = el.getAttribute('aria-describedby');
    if (describedById) {
      const descEl = document.getElementById(describedById);
      if (descEl) ariaDescription = descEl.innerText?.trim();
    }

    // Inspect Form Validity if inside a form
    let formValidity = null;
    if (el.form) {
      formValidity = {
        isValid: el.form.checkValidity(),
        invalidElements: Array.from(el.form.elements)
          .filter(e => !e.validity.valid)
          .map(e => ({ name: e.name, type: e.type, message: e.validationMessage }))
      };
    }

    // Deep React Fiber Inspection
    let reactDiagnosis = {
      isReact: false,
      componentHierarchy: [],
      errorModules: [],
      disabledProps: []
    };

    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (fiberKey) {
      reactDiagnosis.isReact = true;
      let curr = el[fiberKey];
      let depth = 0;

      while (curr && depth < 25) {
        const compName = curr.type?.displayName || curr.type?.name || (typeof curr.type === 'string' ? curr.type : '');
        if (compName) {
          reactDiagnosis.componentHierarchy.push(compName);
        }

        // Inspect props
        const props = curr.memoizedProps;
        if (props && typeof props === 'object') {
          // Check disabled flags
          if (props.disabled || props.isDisabled || props['aria-disabled']) {
            reactDiagnosis.disabledProps.push({
              component: compName || 'Anonymous',
              prop: props.disabled ? 'disabled' : (props.isDisabled ? 'isDisabled' : 'aria-disabled'),
              value: true
            });
          }

          // Safely check for validation errors or warnings in props without circular crash
          function safeStringify(obj, depth = 0) {
            if (depth > 2) return '"[Deep]"';
            if (!obj || typeof obj !== 'object') return typeof obj === 'string' ? JSON.stringify(obj) : String(obj);
            if (obj.nodeType || obj instanceof HTMLElement) return `"[DOM:${obj.tagName || 'node'}]"`;
            try {
              const entries = Object.entries(obj).slice(0, 15).map(([k, v]) => {
                if (typeof v === 'function') return `"${k}":"[Func]"`;
                if (typeof v === 'object' && v !== null) {
                  if (v.nodeType || v instanceof HTMLElement) return `"${k}":"[DOM]"`;
                  return `"${k}":${safeStringify(v, depth + 1)}`;
                }
                return `"${k}":${JSON.stringify(v)}`;
              });
              return `{${entries.join(',')}}`;
            } catch (e) {
              return '"[Unserializable]"';
            }
          }

          // Check for validation errors or warnings in props
          if (props.errors || props.validationErrors || props.warnings) {
            reactDiagnosis.errorModules.push({
              component: compName || 'Anonymous',
              data: safeStringify(props.errors || props.validationErrors || props.warnings)
            });
          }

          // Check for Meta/Relay validation modules in props or nested data
          const stringified = safeStringify(props);
          if (stringified.includes('ValidationModule') || stringified.includes('errorCode') || stringified.includes('warning')) {
            const matches = stringified.match(/"noticeName":"([^"]+)"|"errorCodeNum":([0-9]+)/g);
            if (matches) {
              reactDiagnosis.errorModules.push({
                component: compName || 'Anonymous',
                clues: matches.slice(0, 5)
              });
            }
          }
        }

        curr = curr.return;
        depth++;
      }
    }

    const isBlocked = ariaDisabled || htmlDisabled || isPointerEventsNone || !!coveredBy;

    return {
      found: true,
      text: el.innerText?.trim(),
      isBlocked,
      reasons: {
        ariaDisabled,
        htmlDisabled,
        isPointerEventsNone,
        isZeroSize,
        coveredBy
      },
      tooltipOrDescription: ariaDescription || el.getAttribute('title') || null,
      formValidity,
      reactDiagnosis: reactDiagnosis.isReact ? reactDiagnosis : null,
      summary: !isBlocked 
        ? "El elemento parece HABILITADO e interactivo a nivel DOM." 
        : `Elemento BLOQUEADO. Causas: ${[
            ariaDisabled ? 'aria-disabled="true"' : null,
            htmlDisabled ? 'disabled="true"' : null,
            isPointerEventsNone ? 'pointer-events: none' : null,
            coveredBy ? `Obscurecido por <${coveredBy.tagName}>` : null,
            reactDiagnosis.errorModules.length > 0 ? `Errores de validación React detectados (${reactDiagnosis.errorModules.length})` : null
          ].filter(Boolean).join(', ')}`
    };
  }, selectorOrText);
}

/**
 * React & Vue controlled-input proof filler.
 * Bypasses synthetic event trackers using native HTML prototype descriptors
 * and dispatches genuine bubbling input and change events.
 * 
 * @param {import('playwright').Page} page
 * @param {string|string[]|import('playwright').Locator} selectorOrText - CSS selector, ID, placeholder, aria-label, array of alias fallbacks, or Locator
 * @param {string} value - Text to fill
 * @param {object} [options]
 */
async function smartFill(page, selectorOrText, value, options = {}) {
  const timeout = options.timeout || 3000;
  const targets = Array.isArray(selectorOrText) ? selectorOrText : [selectorOrText];

  // 1. Locate and fill via native prototype setter inside browser context
  const fillResult = await page.evaluate(({ candidateTargets, val, shouldKeepFocus }) => {
    let el = null;
    let matchedTarget = null;
    const candidates = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'));

    for (const target of candidateTargets) {
      if (typeof target !== 'string') continue;
      const t = target.toLowerCase();

      try {
        el = document.querySelector(target);
        if (el) {
          if (el.tagName.toLowerCase() === 'label') {
            if (el.htmlFor) {
              const targetInput = document.getElementById(el.htmlFor);
              if (targetInput) el = targetInput;
            } else {
              const nested = el.querySelector('input, textarea, [contenteditable="true"]');
              if (nested) el = nested;
            }
          }
          matchedTarget = target;
          break;
        }
      } catch (e) {}

      // Search candidates by placeholder, aria-label, name, or id
      el = candidates.find(c => {
        const ph = (c.getAttribute('placeholder') || '').toLowerCase();
        const label = (c.getAttribute('aria-label') || '').toLowerCase();
        const name = (c.getAttribute('name') || '').toLowerCase();
        const id = (c.id || '').toLowerCase();
        return ph === t || label === t || name === t || id === t || ph.includes(t) || label.includes(t);
      });

      if (el) {
        matchedTarget = target;
        break;
      }

      // Search associated <label> elements
      const labels = Array.from(document.querySelectorAll('label'));
      const matchingLabel = labels.find(l => {
        const txt = (l.innerText || '').trim().toLowerCase();
        return txt === t || txt.includes(t);
      });

      if (matchingLabel) {
        if (matchingLabel.htmlFor) {
          const forEl = document.getElementById(matchingLabel.htmlFor);
          if (forEl) {
            el = forEl;
            matchedTarget = target;
            break;
          }
        }
        const nested = matchingLabel.querySelector('input, textarea, [contenteditable="true"]');
        if (nested) {
          el = nested;
          matchedTarget = target;
          break;
        }
        let next = matchingLabel.nextElementSibling;
        while (next && !['input', 'textarea'].includes(next.tagName?.toLowerCase()) && !next.isContentEditable) {
          const childInput = next.querySelector('input, textarea, [contenteditable="true"]');
          if (childInput) {
            next = childInput;
            break;
          }
          next = next.nextElementSibling;
        }
        if (next && (candidates.includes(next) || next.isContentEditable)) {
          el = next;
          matchedTarget = target;
          break;
        }
      }
    }

    if (!el) {
      return { found: false, error: `Input not found for any of: ${JSON.stringify(candidateTargets)}` };
    }

    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { found: true, disabled: true, error: `Input is disabled` };
    }

    el.focus();
    const previousValue = el.value || el.innerText || '';

    if (el.isContentEditable) {
      el.innerText = val;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      if (!shouldKeepFocus) {
        el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
        if (typeof el.blur === 'function') el.blur();
      }
      return { found: true, success: true, isContentEditable: true, target: matchedTarget, previousValue, value: el.innerText };
    }

    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (valueSetter) {
      valueSetter.call(el, val);
    } else {
      el.value = val;
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if (!shouldKeepFocus) {
      el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
      if (typeof el.blur === 'function') el.blur();
    }

    return {
      found: true,
      success: true,
      target: matchedTarget,
      tag: el.tagName.toLowerCase(),
      previousValue,
      value: el.value
    };
  }, { candidateTargets: targets.filter(t => typeof t === 'string'), val: value, shouldKeepFocus: options.keepFocus === true });

  if (!fillResult.found) {
    // Fallback: try Playwright locator if selector was a complex locator or XPath
    for (const target of targets) {
      try {
        const loc = typeof target === 'string' ? page.locator(target).first() : target;
        if (await loc.count() > 0) {
          await loc.fill(value, { timeout });
          return { success: true, method: 'playwright_fill', target: typeof target === 'string' ? target : null, value };
        }
      } catch (e) {}
    }
    return { success: false, error: fillResult.error };
  }

  if (fillResult.disabled) {
    return { success: false, disabled: true, error: fillResult.error };
  }

  return fillResult;
}

/**
 * Resilient multi-tier clicker designed for modern SPAs with nested scroll containers,
 * sticky bars, and overlay pointer-event collisions.
 * 
 * Execution Strategy:
 * 1. Finds the closest scrollable container and centers the element.
 * 2. Attempts Playwright native click with a short timeout.
 * 3. Falls back to physical viewport coordinate click (page.mouse.click) if an overlay intercepts pointer events.
 * 4. Falls back to synthetic DOM event dispatch (el.click() / MouseEvent) if coordinates fail.
 * 
 * @param {import('playwright').Page} page
 * @param {string|import('playwright').Locator} selectorOrText - CSS selector, XPath, text, or Locator
 * @param {object} [options]
 */
async function smartClick(page, selectorOrText, options = {}) {
  const timeout = options.timeout || 3000;

  // 1. Resolve element geometry and ensure it is scrolled into view (including internal scroll containers)
  const elementData = await page.evaluate(({ target }) => {
    let el = null;
    const cleanLabel = (raw) => {
      if (!raw) return '';
      const sanitized = raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
      const firstLine = sanitized.split('\n')[0].trim();
      return firstLine.replace(/\s*\([A-Za-z0-9+⌘⇧⌥⌃\s-]+\)$/, '').trim();
    };

    if (typeof target === 'string') {
      // Try direct selector
      try {
        el = document.querySelector(target);
      } catch (e) {
        // Invalid selector, might be plain text
      }

      // Try text match if not found (prioritize interactive elements over generic wrapper divs)
      if (!el) {
        const interactiveCandidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], [role="menuitem"], [role="tab"]'));
        
        // Priority 1: Exact full text match
        el = interactiveCandidates.find(c => {
          const t = c.innerText ? c.innerText.trim() : '';
          return t.toLowerCase() === target.toLowerCase();
        });

        // Priority 2: Exact match on first line / cleaned label (strips "\nCtrl+Del", "\n⌘D", etc.)
        if (!el) {
          el = interactiveCandidates.find(c => {
            const t = c.innerText ? c.innerText.trim() : '';
            return cleanLabel(t).toLowerCase() === target.toLowerCase();
          });
        }

        // Priority 3: Substring match fallback
        if (!el) {
          el = interactiveCandidates.find(c => {
            const t = c.innerText ? c.innerText.trim() : '';
            return t.toLowerCase().includes(target.toLowerCase());
          });
        }

        if (!el) {
          const leafCandidates = Array.from(document.querySelectorAll('span, div, p, label')).filter(c => c.children.length === 0);
          
          // Priority 1: Exact full text match
          el = leafCandidates.find(c => {
            const t = c.innerText ? c.innerText.trim() : '';
            return t.toLowerCase() === target.toLowerCase();
          });

          // Priority 2: Exact match on cleaned label
          if (!el) {
            el = leafCandidates.find(c => {
              const t = c.innerText ? c.innerText.trim() : '';
              return cleanLabel(t).toLowerCase() === target.toLowerCase();
            });
          }

          // Priority 3: Substring match fallback
          if (!el) {
            el = leafCandidates.find(c => {
              const t = c.innerText ? c.innerText.trim() : '';
              return t.toLowerCase().includes(target.toLowerCase());
            });
          }
        }
      }
    }

    if (!el) {
      return { found: false, error: `Element not found for "${target}"` };
    }

    // Fail-fast on disabled elements before burning 30s timeout
    const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
    if (isDisabled) {
      return {
        found: true,
        disabled: true,
        tag: el.tagName.toLowerCase(),
        text: el.innerText ? el.innerText.trim().substring(0, 80) : '',
        error: `Element "${target}" is disabled (aria-disabled="true" or disabled attribute)`
      };
    }

    // Find closest scrollable ancestor
    let parent = el.parentElement;
    let scrollContainer = null;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight;
      if (isScrollable) {
        scrollContainer = parent;
        break;
      }
      parent = parent.parentElement;
    }

    // Scroll into view inside container or window
    el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

    const rect = el.getBoundingClientRect();
    // Check if element is covered by a floating overlay or banner at its center coordinates
    const topElement = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const isCovered = topElement && topElement !== el && !el.contains(topElement) && !topElement.contains(el);

    const rawText = el.innerText ? el.innerText.trim() : '';
    const clean = cleanLabel(rawText);

    return {
      found: true,
      disabled: false,
      tag: el.tagName.toLowerCase(),
      text: rawText.substring(0, 80),
      cleanLabel: clean,
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0,
      isCovered,
      ariaHasPopup: el.getAttribute('aria-haspopup'),
      initialExpanded: el.getAttribute('aria-expanded')
    };
  }, { target: typeof selectorOrText === 'string' ? selectorOrText : '' });

  if (elementData.disabled && !options.allowDisabled) {
    return {
      success: false,
      disabled: true,
      error: `[smartClick] Fail-fast: Element "${elementData.text}" is disabled (aria-disabled="true"). Check if prerequisite selection is required.`
    };
  }

  // Tier 1: Try Playwright native locator click (if not covered by overlay)
  if (!elementData.isCovered) {
    try {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let loc = null;
      if (typeof selectorOrText === 'string') {
        if (selectorOrText.startsWith('/') || selectorOrText.includes('[') || selectorOrText.includes('.') || selectorOrText.includes('#')) {
          loc = page.locator(selectorOrText).first();
        } else {
          // Priority 1: Match by exact clean label boundary (prevents "Eliminar" matching "Eliminar contenido multimedia")
          const targetLabel = elementData.cleanLabel || selectorOrText;
          const exactRegex = new RegExp(`^\\s*${escapeRegex(targetLabel)}(\\s*\\n|\\s*$)`, 'i');
          const exactCandidate = page.locator(`button, div[role="button"], a, div[role="menuitem"]`).filter({ hasText: exactRegex }).first();
          if (await exactCandidate.count() > 0) {
            loc = exactCandidate;
          } else {
            loc = page.locator(`button, div[role="button"], a, div[role="menuitem"]`).filter({ hasText: selectorOrText }).first();
          }
        }
      } else {
        loc = selectorOrText;
      }

      if (loc && await loc.count() > 0) {
        await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
        await loc.click({ timeout: Math.min(timeout, 2500), force: false, ...options });
        return { success: true, method: 'playwright_click', tag: elementData.tag, text: elementData.text };
      }
    } catch (e) {
      // If Playwright click timed out or was intercepted, proceed to coordinate or synthetic tiers
    }
  }

  // Tier 2: Atomic Physical Mouse Click with fresh bounding box (only if not covered by a foreign overlay)
  if (elementData && elementData.found && elementData.visible && !elementData.isCovered) {
    try {
      const loc = typeof selectorOrText === 'string'
        ? (selectorOrText.startsWith('/') || selectorOrText.includes('[') || selectorOrText.includes('.') || selectorOrText.includes('#')
            ? page.locator(selectorOrText).first()
            : page.locator(`button, div[role="button"], a, div[role="menuitem"]`).filter({ hasText: selectorOrText }).first())
        : selectorOrText;

      if (await loc.count() > 0) {
        await loc.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
        const freshBox = await loc.boundingBox();
        if (freshBox && freshBox.width > 0) {
          const clickX = freshBox.x + freshBox.width / 2;
          const clickY = freshBox.y + freshBox.height / 2;

          // Check if coordinates fall inside the current visible viewport
          const inViewport = await page.evaluate(({ x, y }) => {
            return x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
          }, { x: clickX, y: clickY }).catch(() => true);

          if (inViewport) {
            await page.mouse.click(clickX, clickY, options);
            return { success: true, method: 'physical_coordinate_click', x: clickX, y: clickY, text: elementData.text };
          }
        }
      } else if (!elementData.isCovered) {
        // Check if coordinates fall inside viewport
        const inViewport = await page.evaluate(({ x, y }) => {
          return x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
        }, { x: elementData.x, y: elementData.y }).catch(() => true);

        if (inViewport) {
          await page.mouse.click(elementData.x, elementData.y, options);
          return { success: true, method: 'physical_coordinate_click', x: elementData.x, y: elementData.y, text: elementData.text };
        }
      }
    } catch (e) {
      // Coordinate click failed, fall through to Tier 3
    }
  }

  // Tier 3: Synthetic Event Dispatch on DOM node (essential when covered by sticky headers/overlays)
  const dispatchResult = await page.evaluate(({ target }) => {
    const cleanLabel = (raw) => {
      if (!raw) return '';
      const sanitized = raw.replace(/[\u200B-\u200D\uFEFF]/g, '');
      const firstLine = sanitized.split('\n')[0].trim();
      return firstLine.replace(/\s*\([A-Za-z0-9+⌘⇧⌥⌃\s-]+\)$/, '').trim();
    };

    let el = null;
    try { el = document.querySelector(target); } catch (e) {}
    if (!el) {
      const interactiveCandidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], [role="menuitem"], [role="tab"]'));
      
      // Exact full match
      el = interactiveCandidates.find(c => (c.innerText ? c.innerText.trim().toLowerCase() : '') === target.toLowerCase());
      // Exact clean label match
      if (!el) {
        el = interactiveCandidates.find(c => cleanLabel(c.innerText ? c.innerText.trim() : '').toLowerCase() === target.toLowerCase());
      }
      // Substring match
      if (!el) {
        el = interactiveCandidates.find(c => c.innerText && c.innerText.trim().toLowerCase().includes(target.toLowerCase()));
      }

      if (!el) {
        const leafCandidates = Array.from(document.querySelectorAll('span, div, p, label')).filter(c => c.children.length === 0);
        el = leafCandidates.find(c => (c.innerText ? c.innerText.trim().toLowerCase() : '') === target.toLowerCase());
        if (!el) {
          el = leafCandidates.find(c => cleanLabel(c.innerText ? c.innerText.trim() : '').toLowerCase() === target.toLowerCase());
        }
        if (!el) {
          el = leafCandidates.find(c => c.innerText && c.innerText.trim().toLowerCase().includes(target.toLowerCase()));
        }
      }
    }
    if (!el) return { success: false, error: 'Element not found for synthetic dispatch' };

    // Modern SPAs (React 18, Meta Comet, Twitter/X) use Pressable primitives listening to PointerEvents
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === 'function') el.click();

    // Check if this was a popover/menu trigger and if state actually changed
    const hadPopup = el.getAttribute('aria-haspopup');
    const wasClosed = el.getAttribute('aria-expanded') === 'false';
    const isNowExpanded = el.getAttribute('aria-expanded') === 'true';

    return {
      success: true,
      method: 'synthetic_dom_dispatch',
      text: el.innerText?.trim(),
      hadPopup,
      popoverVerified: hadPopup ? (wasClosed && isNowExpanded) : true
    };
  }, { target: typeof selectorOrText === 'string' ? selectorOrText : '' });

  // If synthetic dispatch reported success but a popover menu failed to actually expand,
  // do a last-resort forced physical click directly at coordinates
  if (dispatchResult.success && dispatchResult.hadPopup && !dispatchResult.popoverVerified) {
    try {
      await page.mouse.click(elementData.x, elementData.y, { force: true });
      return { success: true, method: 'physical_forced_recovery', x: elementData.x, y: elementData.y, text: elementData.text };
    } catch (e) {}
  }

  if (dispatchResult.success) {
    return dispatchResult;
  }

  throw new Error(`[smartClick] Failed to click "${selectorOrText}" through all 3 tiers.`);
}

/**
 * Universal file uploader that safely triggers native fileChoosers or file inputs.
 * Ensures the target file exists, sets up the fileChooser promise, and clicks the trigger.
 * 
 * @param {import('playwright').Page} page
 * @param {string|import('playwright').Locator} triggerSelectorOrText
 * @param {string} filePath
 * @param {object} [options]
 */
async function uploadFile(page, triggerSelectorOrText, filePath, options = {}) {
  const fs = require('fs');
  const path = require('path');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[uploadFile] File does not exist on disk: "${resolved}"`);
  }

  const timeout = options.timeout || 15000;

  // Check if a direct file input already exists and no specific trigger was demanded
  const directInput = page.locator('input[type="file"]').first();
  if (await directInput.count() > 0 && !triggerSelectorOrText) {
    try {
      await directInput.setInputFiles(resolved);
      return { success: true, method: 'direct_input', filePath: resolved };
    } catch (e) {
      // Fallback to trigger click below
    }
  }

  // FileChooser coordination with resilient direct-input fallback
  try {
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: Math.min(timeout, 3500) });
    // Click the trigger button using our resilient smartClick
    await smartClick(page, triggerSelectorOrText, { timeout: 3500 });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(resolved);

    return {
      success: true,
      method: 'file_chooser',
      filePath: resolved,
      fileName: path.basename(resolved)
    };
  } catch (err) {
    // If native filechooser didn't fire in 3.5s, check if an input[type="file"] exists or was mounted
    const input = page.locator('input[type="file"]').first();
    if (await input.count() > 0) {
      await input.setInputFiles(resolved);
      return {
        success: true,
        method: 'direct_input_fallback',
        filePath: resolved,
        fileName: path.basename(resolved)
      };
    }
    throw new Error(`[uploadFile] Failed to coordinate file upload via filechooser or input[type="file"]: ${err.message}`);
  }
}

/**
 * Robust active modal extractor.
 * Filters out system notification popovers, ambient bell dialogs, and hidden overlays,
 * returning the topmost user-facing modal dialog.
 * 
 * @param {import('playwright').Page} page
 * @param {string} [textClue] - Optional keyword to match against dialog text
 */
async function getActiveModal(page, textClue = null) {
  return await page.evaluate((clue) => {
    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], dialog, [aria-modal="true"]'))
      .filter(d => {
        const rect = d.getBoundingClientRect();
        const style = window.getComputedStyle(d);
        const isVisible = rect.width > 100 && rect.height > 100 && style.display !== 'none' && style.visibility !== 'hidden';
        if (!isVisible) return false;

        const text = d.innerText || '';
        // Ignore ambient notification popovers
        const isNotificationPopover = text.includes('Notificaciones') && text.includes('No leídas') && rect.width < 450;
        if (isNotificationPopover && (!clue || !clue.includes('Notificaciones'))) {
          return false;
        }

        if (clue) {
          return text.toLowerCase().includes(clue.toLowerCase());
        }
        return true;
      });

    if (dialogs.length === 0) return null;

    // Pick topmost dialog by z-index or DOM order
    dialogs.sort((a, b) => {
      const zA = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
      const zB = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
      return zB - zA;
    });

    const top = dialogs[0];
    const rect = top.getBoundingClientRect();

    const buttons = Array.from(top.querySelectorAll('button, div[role="button"]')).map(b => ({
      text: b.innerText ? b.innerText.trim().replace(/\n+/g, ' ') : '',
      ariaLabel: b.getAttribute('aria-label'),
      disabled: b.getAttribute('aria-disabled') === 'true' || b.disabled === true
    })).filter(b => b.text || b.ariaLabel);

    const inputs = Array.from(top.querySelectorAll('input, textarea, [contenteditable="true"]')).map(i => ({
      placeholder: i.placeholder || i.getAttribute('aria-label'),
      value: i.value || (i.isContentEditable ? i.innerText : ''),
      type: i.type || (i.isContentEditable ? 'contenteditable' : 'text')
    }));

    return {
      title: top.querySelector('h1, h2, h3, [role="heading"]')?.innerText?.trim() || null,
      textSnippet: top.innerText ? top.innerText.substring(0, 300) : '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      buttons,
      inputs
    };
  }, textClue);
}

/**
 * Resolves an active modal confirmation dialog safely.
 * Handles confirmation ('confirm') or dismissal ('cancel') without stalling on full-screen backdrops.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {'confirm'|'cancel'} [options.action='confirm']
 * @param {string} [options.confirmText] - Custom label for confirmation button
 * @param {string} [options.cancelText] - Custom label for cancellation button
 * @param {string} [options.titleClue] - Keyword in title/body to identify target modal
 * @param {number} [options.timeout=5000] - Max wait time for modal to appear
 */
async function handleModal(page, options = {}) {
  const action = options.action || 'confirm';
  const timeout = options.timeout || 5000;
  const start = Date.now();

  let modal = null;
  while (Date.now() - start < timeout) {
    modal = await getActiveModal(page, options.titleClue);
    if (modal) break;
    await page.waitForTimeout(100);
  }

  if (!modal) {
    return { success: false, error: `No active modal found${options.titleClue ? ` matching "${options.titleClue}"` : ''}` };
  }

  const defaultConfirms = ['aceptar', 'confirmar', 'continuar', 'eliminar', 'duplicar', 'guardar', 'listo', 'ok', 'yes', 'confirm', 'delete', 'proceed', 'entendido', 'got it', 'de acuerdo'];
  const defaultCancels = ['cancelar', 'cerrar', 'descartar', 'no', 'cancel', 'dismiss', 'close', 'entendido', 'got it', 'ahora no', 'not now', 'omitir', 'skip', 'más tarde', 'later', 'de acuerdo'];

  // Modals usually place primary action buttons at the footer/bottom. Reverse array to prioritize footer actions.
  const modalButtons = [...modal.buttons].reverse();

  let targetButtonText = null;
  if (action === 'confirm') {
    if (options.confirmText) {
      targetButtonText = options.confirmText;
    } else {
      // 1. Exact match on clean label
      let match = modalButtons.find(b => defaultConfirms.some(dc => b.text.trim().toLowerCase() === dc));
      // 2. Substring match fallback
      if (!match) {
        match = modalButtons.find(b => defaultConfirms.some(dc => b.text.toLowerCase().includes(dc)));
      }
      targetButtonText = match ? match.text : (modalButtons.length === 1 ? modalButtons[0].text : null);
    }
  } else {
    if (options.cancelText) {
      targetButtonText = options.cancelText;
    } else {
      // 1. Exact match on clean label
      let match = modalButtons.find(b => defaultCancels.some(dc => b.text.trim().toLowerCase() === dc));
      // 2. Substring match fallback
      if (!match) {
        match = modalButtons.find(b => defaultCancels.some(dc => b.text.toLowerCase().includes(dc)));
      }
      targetButtonText = match ? match.text : (modalButtons.length === 1 ? modalButtons[0].text : null);
    }
  }

  if (!targetButtonText) {
    return {
      success: false,
      error: `Could not identify ${action} button in modal. Available buttons: ${modal.buttons.map(b => b.text).join(', ')}`,
      modal
    };
  }

  // Target button strictly inside the active modal dialog container to avoid clicking background buttons
  const modalLocator = page.locator('div[role="dialog"], dialog, [aria-modal="true"]').first();
  const modalBtn = modalLocator.locator('button, div[role="button"]').filter({ hasText: targetButtonText }).last();

  if (await modalBtn.count() > 0) {
    try {
      await modalBtn.click({ timeout: 2000, force: true });
    } catch (e) {
      // Fallback to synthetic pointer & click events on the button inside the active dialog
      await page.evaluate(({ btnText }) => {
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], dialog, [aria-modal="true"]'));
        const dialog = dialogs[dialogs.length - 1] || dialogs[0];
        if (!dialog) return;
        const btns = Array.from(dialog.querySelectorAll('button, div[role="button"]'));
        const btn = btns.find(b => b.innerText && b.innerText.trim().toLowerCase().includes(btnText.toLowerCase()));
        if (btn) {
          try {
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
          } catch (err) {}
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          if (typeof btn.click === 'function') btn.click();
        }
      }, { btnText: targetButtonText });
    }
  } else {
    // Fallback to smartClick if not matched by strict container locator
    await smartClick(page, targetButtonText, { timeout: 3000 });
  }

  await page.waitForTimeout(400);

  return {
    success: true,
    action,
    clickedButton: targetButtonText,
    modalTitle: modal.title,
    modalSnippet: modal.textSnippet.substring(0, 100)
  };
}

/**
 * Automatically detects and dismisses non-critical ambient popups, cookie consent banners,
 * or spontaneous AI/upsell modals that would otherwise block UI automation.
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {string[]} [options.keywords] - Keywords matching modals to dismiss
 * @param {boolean} [options.acceptCookies=true] - Whether to click Accept/Allow on cookie consent banners
 */
async function dismissAmbientModals(page, options = {}) {
  const defaultAmbientKeywords = [
    'cookies', 'cookie', 'novedades', 'traducción', 'traducciones', 'advantage+',
    'whats new', 'what\'s new', 'feedback', 'encuesta', 'recomendación', 'recomendaciones',
    'sugerencia', 'asistente', 'tips', 'consejos'
  ];

  const keywords = options.keywords || defaultAmbientKeywords;
  const modal = await getActiveModal(page);

  if (!modal) {
    return { dismissed: false, reason: 'no_modal' };
  }

  const modalText = ((modal.title || '') + ' ' + (modal.textSnippet || '')).toLowerCase();
  const isAmbient = keywords.some(kw => modalText.includes(kw.toLowerCase()));

  if (!isAmbient) {
    return { dismissed: false, reason: 'not_ambient', title: modal.title };
  }

  // Dismiss by confirming or cancelling depending on type
  const isCookieBanner = modalText.includes('cookie') || modalText.includes('cookies');
  const action = (isCookieBanner && options.acceptCookies !== false) ? 'confirm' : 'cancel';

  const res = await handleModal(page, { action });
  return {
    dismissed: res.success,
    action,
    title: modal.title,
    snippet: modal.textSnippet ? modal.textSnippet.substring(0, 80) : ''
  };
}

/**
 * Lightweight, token-efficient semantic state inspector for AI agents.
 * Extracts currently visible modals, primary action buttons, inputs with values,
 * and error/warning alerts in a clean, structured JSON format.
 * 
 * @param {import('playwright').Page} page
 * @param {object} [options]
 */
async function inspectState(page, options = {}) {
  const activeModal = await getActiveModal(page);

  const pageState = await page.evaluate(() => {
    // 1. Visible interactive buttons (excluding tiny icons or unlabelled spans)
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]')).filter(b => {
      const rect = b.getBoundingClientRect();
      const style = window.getComputedStyle(b);
      return rect.width > 15 && rect.height > 15 && style.display !== 'none' && style.visibility !== 'hidden' && b.offsetParent !== null;
    }).map(b => {
      const text = b.innerText ? b.innerText.trim().replace(/\n+/g, ' ') : '';
      const ariaLabel = b.getAttribute('aria-label');
      const isDisabled = b.getAttribute('aria-disabled') === 'true' || b.disabled === true;
      return {
        text: text || ariaLabel || '',
        ariaLabel: ariaLabel || null,
        disabled: isDisabled
      };
    }).filter(b => b.text.length > 0 && b.text.length < 80);

    // 2. Visible input fields
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')).filter(i => {
      const rect = i.getBoundingClientRect();
      const style = window.getComputedStyle(i);
      return rect.width > 20 && rect.height > 15 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map(i => {
      const placeholder = i.placeholder || i.getAttribute('aria-label') || '';
      const val = i.value !== undefined ? i.value : (i.isContentEditable ? i.innerText.trim() : '');
      const type = i.type || (i.isContentEditable ? 'contenteditable' : 'text');
      return {
        type,
        placeholder,
        value: val.substring(0, 100)
      };
    });

    // 3. Alerts and validation errors
    const alertElements = Array.from(document.querySelectorAll('[role="alert"], [aria-live="assertive"], .error-message, [data-testid*="error"]')).filter(a => {
      const rect = a.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && a.innerText && a.innerText.trim().length > 0;
    }).map(a => a.innerText.trim().replace(/\n+/g, ' '));

    return {
      url: window.location.href,
      title: document.title,
      buttons: buttons.slice(0, 25),
      inputs: inputs.slice(0, 15),
      alerts: Array.from(new Set(alertElements)).slice(0, 5)
    };
  });

  return {
    url: pageState.url,
    title: pageState.title,
    activeModal: activeModal ? {
      title: activeModal.title,
      textSnippet: activeModal.textSnippet.substring(0, 150),
      buttons: activeModal.buttons,
      inputs: activeModal.inputs
    } : null,
    buttons: pageState.buttons,
    inputs: pageState.inputs,
    alerts: pageState.alerts
  };
}

/**
 * Intelligent primary button clicker.
 * Automatically avoids split-button dropdown arrows ([aria-haspopup="menu"])
 * and selects the main actionable button.
 * 
 * @param {import('playwright').Page} page
 * @param {string} textOrSelector
 * @param {object} [options]
 */
async function clickPrimary(page, textOrSelector, options = {}) {
  // Try Playwright locators with strict filtering first
  const locator = page.locator(`button, div[role="button"], a[role="button"]`)
    .filter({ hasText: textOrSelector })
    .filter({ hasNot: page.locator('[aria-haspopup="menu"], [aria-haspopup="true"]') })
    .first();

  const count = await locator.count();
  if (count > 0) {
    await locator.scrollIntoViewIfNeeded();
    await locator.click(options);
    return { success: true, method: 'playwright_filtered_locator' };
  }

  // Fallback to in-page evaluation
  const result = await page.evaluate((targetText) => {
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));
    const matches = buttons.filter(b => 
      b.innerText && b.innerText.trim().toLowerCase().includes(targetText.toLowerCase())
    );

    if (matches.length === 0) return { success: false, error: 'Button not found' };

    // Discard elements that are dropdown menus or split-arrows
    const primary = matches.find(b => 
      b.getAttribute('aria-haspopup') !== 'menu' && 
      b.getAttribute('aria-haspopup') !== 'true' &&
      !b.className.includes('split') &&
      !b.getAttribute('aria-expanded')
    ) || matches[0];

    primary.scrollIntoView({ behavior: 'instant', block: 'center' });
    primary.click();
    return { success: true, method: 'dom_primary_match', clickedText: primary.innerText?.trim() };
  }, textOrSelector);

  if (!result.success) {
    throw new Error(`[clickPrimary] Could not find primary button matching "${textOrSelector}"`);
  }

  return result;
}

/**
 * Resilient combobox / autocomplete / portal typeahead selector.
 * Solves the universal 30-second Playwright timeout on floating contextual layers
 * (e.g. Meta Ads contextual layers, Radix portals, React Select, AntD, Jira user pickers).
 *
 * Strategy:
 * 1. Focuses and fills the search text into the input using smartFill.
 * 2. Attempts W3C accessible keyboard selection (ArrowDown + Enter) in <300ms.
 * 3. Falls back to targeting floating portal layers ([role="option"], [role="listbox"],
 *    .uiContextualLayerPositioner, [data-radix-portal]) with smartClick (max 2s timeout, never 30s).
 * 4. Dispatches full blur / focusout lifecycle to commit framework state.
 *
 * @param {import('playwright').Page} page
 * @param {string|string[]|import('playwright').Locator} inputSelectorOrText
 * @param {string} optionText
 * @param {object} [options]
 * @param {number} [options.timeout=5000]
 * @param {boolean} [options.preferKeyboard=true]
 */
async function smartSelect(page, inputSelectorOrText, optionText, options = {}) {
  const timeout = options.timeout || 5000;
  const preferKeyboard = options.preferKeyboard !== false;

  // Step 1: Fill the search keyword into the combobox input while keeping focus
  const fillRes = await smartFill(page, inputSelectorOrText, optionText, { timeout: 2500, keepFocus: true });
  if (!fillRes.success && !fillRes.found) {
    return { success: false, error: `[smartSelect] Could not find input for "${JSON.stringify(inputSelectorOrText)}": ${fillRes.error}` };
  }

  await page.waitForTimeout(options.filterDelay || 400);

  // Step 2: Try W3C accessible keyboard selection (ArrowDown + Enter)
  if (preferKeyboard) {
    try {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Verify if the selection took effect via keyboard
      const keyboardCommitted = await page.evaluate(({ optText, initialVal }) => {
        const active = document.activeElement;
        const val = active ? (active.value || active.innerText || '') : '';

        // 1. Check if an option is marked as selected in an open listbox
        const selectedOption = document.querySelector('[role="option"][aria-selected="true"], [role="option"].active, .selected[role="listitem"], .option-item.active');
        if (selectedOption && (selectedOption.innerText || '').toLowerCase().includes(optText.toLowerCase())) {
          return true;
        }

        // 2. Check if open listboxes closed upon Enter
        const listboxes = Array.from(document.querySelectorAll('[role="listbox"], .portal-layer, .uiContextualLayerPositioner'));
        const anyOpen = listboxes.some(lb => {
          const style = window.getComputedStyle(lb);
          return style.display !== 'none' && style.visibility !== 'hidden' && lb.offsetParent !== null;
        });

        if (!anyOpen && val.length > 0 && val !== initialVal) {
          return true;
        }

        return false;
      }, { optText: optionText, initialVal: fillRes.previousValue });

      if (keyboardCommitted) {
        // Ensure blur lifecycle dispatches
        await page.evaluate(() => {
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.dispatchEvent(new Event('change', { bubbles: true }));
            document.activeElement.dispatchEvent(new Event('blur', { bubbles: true }));
            document.activeElement.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
            document.activeElement.blur();
          }
        });
        return { success: true, method: 'keyboard_arrow_enter', option: optionText };
      }
    } catch (e) {}
  }

  // Step 3: Targeted floating portal search (prevents 30s Playwright stall)
  const portalResult = await page.evaluate(({ optText }) => {
    const target = optText.toLowerCase();

    // Query both standard options and custom floating portal layers (Meta, Radix, Popper, React Select)
    const candidates = Array.from(document.querySelectorAll(
      '[role="option"], [role="listbox"] div, [role="listbox"] li, ' +
      '.uiContextualLayerPositioner li, .uiContextualLayerPositioner div, ' +
      '[data-radix-portal] [role="option"], [data-radix-popper-content-wrapper] div, ' +
      '.ant-select-item-option, .select__option, ul[role="listbox"] > li'
    )).filter(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (candidates.length === 0) return { found: false };

    // 1. Exact match on clean label
    let match = candidates.find(c => {
      const txt = (c.innerText || '').trim().toLowerCase();
      return txt === target;
    });

    // 2. Substring match
    if (!match) {
      match = candidates.find(c => {
        const txt = (c.innerText || '').trim().toLowerCase();
        return txt.includes(target);
      });
    }

    if (!match) return { found: false, count: candidates.length };

    // Center and scroll
    match.scrollIntoView({ behavior: 'instant', block: 'nearest' });

    // Synthetic Pointer & Click dispatch
    try {
      match.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      match.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {}
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof match.click === 'function') match.click();

    return {
      found: true,
      text: match.innerText ? match.innerText.trim().substring(0, 80) : ''
    };
  }, { optText: optionText });

  if (portalResult.found) {
    // Ensure blur lifecycle on the input
    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.dispatchEvent(new Event('change', { bubbles: true }));
        document.activeElement.dispatchEvent(new Event('blur', { bubbles: true }));
        document.activeElement.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        document.activeElement.blur();
      }
    });
    return { success: true, method: 'portal_synthetic_dispatch', option: portalResult.text };
  }

  // Step 4: Fallback to smartClick with a strictly bounded 2-second timeout (never 30s)
  try {
    const clickRes = await smartClick(page, optionText, { timeout: 2000 });
    return { success: true, method: 'smart_click_fallback', detail: clickRes };
  } catch (e) {
    return {
      success: false,
      error: `[smartSelect] Option "${optionText}" could not be selected via keyboard, portal layers, or smartClick.`
    };
  }
}

/**
 * Get an existing tab matching a URL pattern or create one if not found.
 * Prevents tab clutter when automating over persistent Chrome CDP.
 * 
 * @param {import('playwright').BrowserContext} context
 * @param {RegExp|string} urlPattern
 * @param {string} [fallbackUrl]
 */
async function getOrCreateTab(context, urlPattern, fallbackUrl = 'about:blank') {
  const pages = context.pages();
  const matcher = typeof urlPattern === 'string' 
    ? (url) => url.includes(urlPattern)
    : (url) => urlPattern.test(url);

  const existingPage = pages.find(p => matcher(p.url()));
  if (existingPage) {
    return { page: existingPage, isNew: false };
  }

  const newPage = await context.newPage();
  if (fallbackUrl && fallbackUrl !== 'about:blank') {
    await newPage.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
  }
  return { page: newPage, isNew: true };
}

/**
 * Decorate a Playwright Page instance with harness helper methods.
 * 
 * @param {import('playwright').Page} page
 */
function attachHarness(page) {
  if (!page) return page;

  // Optional site recipes. A missing recipe must never break the harness.
  try {
    require('./sites/jira').attachJira(page);
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  page.smartFill = (selector, val, opts) => smartFill(page, selector, val, opts);
  page.smartClick = (target, opts) => smartClick(page, target, opts);
  page.uploadFile = (trigger, filePath, opts) => uploadFile(page, trigger, filePath, opts);
  page.getActiveModal = (textClue) => getActiveModal(page, textClue);
  page.handleModal = (opts) => handleModal(page, opts);
  page.dismissAmbientModals = (opts) => dismissAmbientModals(page, opts);
  page.smartSelect = (input, optText, opts) => smartSelect(page, input, optText, opts);
  page.inspectState = (opts) => inspectState(page, opts);
  page.explainDisabled = (selector) => explainDisabled(page, selector);
  page.clickPrimary = (text, opts) => clickPrimary(page, text, opts);

  return page;
}

module.exports = {
  smartFill,
  smartClick,
  smartSelect,
  uploadFile,
  getActiveModal,
  handleModal,
  dismissAmbientModals,
  inspectState,
  explainDisabled,
  clickPrimary,
  getOrCreateTab,
  attachHarness
};
