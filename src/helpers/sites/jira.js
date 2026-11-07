'use strict';
/**
 * Jira Cloud helpers for gamba-browser.
 *
 * Validated against Jira Cloud. Set GAMBA_JIRA_BASE_URL for your instance.
 * They avoid the traps found while publishing evidence inside comments:
 * keyboard shortcuts that open the description, hidden file inputs that
 * never finish the upload, and `type()` losing characters on long text.
 */

const { hideBrowser } = require('../../browser');

const COMMENT_PREFIX = 'issue-comment-base.ui.comment.ak-comment';
const EDIT_BUTTON = '[data-testid="issue-comment-base.ui.comment.edit-tooltip"]';
const MEDIA_BUTTON = '[data-testid="editor-toolbar-media-button"]';
const SAVE_BUTTON = 'button:has-text("Guardar"):visible, button:has-text("Save"):visible';

const issueUrl = (key) => {
  if (/^https?:\/\//.test(key)) return key;
  const base = process.env.GAMBA_JIRA_BASE_URL || process.env.JIRA_BASE_URL;
  if (!base) {
    throw new Error('Set GAMBA_JIRA_BASE_URL (e.g. https://your-org.atlassian.net) to use issue keys.');
  }
  return `${base.replace(/\/$/, '')}/browse/${key}`;
};

/**
 * Runs Chrome without stealing focus from the human.
 * Call before navigating: `bringToFront` must stay false, and the process
 * gets hidden so the window never covers the user's work.
 */
function workInBackground() {
  hideBrowser();
}

/** Opens an issue and waits for the activity feed to render. */
async function openIssue(page, key, { wait = 5000 } = {}) {
  await page.goto(issueUrl(key), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  return page.url();
}

/** Returns the plain text of one comment body. */
async function commentText(page, commentId) {
  const body = page.locator(`[data-testid="${COMMENT_PREFIX}.${commentId}-body"]`).first();
  await body.waitFor({ timeout: 20000 });
  return body.innerText();
}

/** Opens the inline editor of one existing comment. */
async function editComment(page, commentId) {
  const container = page.locator(`[data-testid="${COMMENT_PREFIX}.${commentId}"]`).first();
  await container.scrollIntoViewIfNeeded();
  const edit = container.locator(EDIT_BUTTON).first();
  await edit.click();
  const editor = page.locator('[contenteditable="true"]').last();
  await editor.waitFor({ timeout: 20000 });
  return editor;
}

/**
 * Replaces the editor content with the given paragraphs.
 * Uses insertText: `type()` with delay drops characters on long bodies.
 */
async function writeParagraphs(page, paragraphs) {
  const editor = page.locator('[contenteditable="true"]').last();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  for (let i = 0; i < paragraphs.length; i += 1) {
    await page.keyboard.insertText(paragraphs[i]);
    if (i < paragraphs.length - 1) await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(400);
  return editor;
}

/**
 * Embeds a file inside the open editor using a synthetic drag & drop.
 * Returns true only when the file chip appears, so callers never save a
 * comment that silently lost the attachment.
 */
async function embedFile(page, absolutePath, { timeoutMs = 30000 } = {}) {
  const fs = require('fs');
  const path = require('path');
  const name = path.basename(absolutePath);
  const b64 = fs.readFileSync(absolutePath).toString('base64');
  const mime = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';

  await page.keyboard.press('Enter');
  await page.evaluate(
    ({ b64, name, mime }) => {
      const editors = [...document.querySelectorAll('[contenteditable="true"]')];
      const target = editors[editors.length - 1];
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: mime }));
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      }
    },
    { b64, name, mime },
  );

  const editor = page.locator('[contenteditable="true"]').last();
  const chip = editor.locator(`text=${name}`).first();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await chip.count()) > 0) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Saves the open editor. */
async function saveEditor(page, { wait = 14000 } = {}) {
  const save = page.locator(SAVE_BUTTON).last();
  await save.waitFor({ timeout: 20000 });
  await save.click();
  await page.waitForTimeout(wait);
}

/** Reads the stored ADF of a comment through the rendered body text only. */
async function commentHasMedia(page, commentId, fileName) {
  const text = await commentText(page, commentId);
  return text.includes(fileName);
}

/**
 * Attaches helpers to a Playwright page: `page.jira.openIssue(...)`, etc.
 * Called from attachHarness so every script and `gamba-exec` gets them.
 */
function attachJira(page) {
  page.jira = {
    workInBackground,
    openIssue: (key, options) => openIssue(page, key, options),
    commentText: (commentId) => commentText(page, commentId),
    editComment: (commentId) => editComment(page, commentId),
    writeParagraphs: (paragraphs) => writeParagraphs(page, paragraphs),
    embedFile: (absolutePath, options) => embedFile(page, absolutePath, options),
    saveEditor: (options) => saveEditor(page, options),
    commentHasMedia: (commentId, fileName) => commentHasMedia(page, commentId, fileName),
    selectors: { COMMENT_PREFIX, EDIT_BUTTON, MEDIA_BUTTON, SAVE_BUTTON },
  };
  return page;
}

module.exports = {
  attachJira,
  workInBackground,
  openIssue,
  commentText,
  editComment,
  writeParagraphs,
  embedFile,
  saveEditor,
  commentHasMedia,
  COMMENT_PREFIX,
  EDIT_BUTTON,
  MEDIA_BUTTON,
  SAVE_BUTTON,
};
