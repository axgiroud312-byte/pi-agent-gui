// Asset health is machine-checkable, but is not a substitute for visual review.
export async function visibleImageHealth(page) {
  const handle = await page.waitForFunction(() => {
    const images = [...document.images].filter(image => {
      const box = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
        box.top < innerHeight && box.left < innerWidth && style.visibility !== 'hidden' && style.opacity !== '0';
    }).map(image => ({
      source: image.currentSrc.startsWith('data:') ? '[inline image]' : image.currentSrc,
      complete: image.complete, width: image.naturalWidth, height: image.naturalHeight,
    }));
    return images.every(image => image.complete && image.width > 0 && image.height > 0) ? images : false;
  }, undefined, { timeout: 10_000 });
  try { return await handle.jsonValue(); }
  finally { await handle.dispose(); }
}
