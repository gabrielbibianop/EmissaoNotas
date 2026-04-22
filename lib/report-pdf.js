import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.08, 0.12, 0.18);
const SOFT = rgb(0.42, 0.49, 0.58);
const BORDER = rgb(0.83, 0.88, 0.93);
const ACCENT = rgb(0.06, 0.38, 0.99);
const ACCENT_SOFT = rgb(0.86, 0.92, 1);

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function safeText(value) {
  return String(value ?? "").trim();
}

function truncate(value, max = 40) {
  const normalized = safeText(value);
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function drawText(page, font, text, x, y, size, color = BLACK) {
  if (!text) {
    return;
  }

  page.drawText(String(text), { x, y, size, font, color });
}

function drawWrappedText(page, font, text, x, y, size, maxWidth, maxLines = 2, color = BLACK) {
  const words = safeText(text).split(/\s+/).filter(Boolean);

  if (!words.length) {
    return y;
  }

  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(next, size);

    if (!current || width <= maxWidth) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(truncate(current, 60));
  }

  lines.forEach((line, index) => {
    drawText(page, font, line, x, y - index * (size + 2), size, color);
  });

  return y - (lines.length - 1) * (size + 2);
}

function drawHeader(page, fonts, title, subtitle) {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 84,
    width: PAGE_WIDTH,
    height: 84,
    color: rgb(0.95, 0.98, 1)
  });

  drawText(page, fonts.bold, "Portal Fiscal", MARGIN, PAGE_HEIGHT - 36, 10, ACCENT);
  drawText(page, fonts.bold, title, MARGIN, PAGE_HEIGHT - 60, 20);
  drawText(page, fonts.regular, subtitle, MARGIN, PAGE_HEIGHT - 76, 9, SOFT);
}

function drawSummary(page, fonts, items) {
  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - 24) / items.length;
  const baseY = PAGE_HEIGHT - 150;

  items.forEach((item, index) => {
    const x = MARGIN + index * (cardWidth + 8);

    page.drawRectangle({
      x,
      y: baseY,
      width: cardWidth,
      height: 52,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 1
    });

    drawText(page, fonts.regular, item.label, x + 12, baseY + 34, 8, SOFT);
    drawText(page, fonts.bold, item.value, x + 12, baseY + 14, 14);
  });

  return baseY - 16;
}

function drawTableHeader(page, fonts, columns, y) {
  let currentX = MARGIN;

  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 22,
    color: ACCENT_SOFT,
    borderColor: BORDER,
    borderWidth: 1
  });

  columns.forEach((column) => {
    drawText(page, fonts.bold, column.label.toUpperCase(), currentX + 6, y + 4, 8, ACCENT);
    currentX += column.width;
  });

  return y - 22;
}

function drawRow(page, fonts, columns, row, y) {
  let currentX = MARGIN;
  let minY = y;

  page.drawRectangle({
    x: MARGIN,
    y: y - 2,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 24,
    color: WHITE,
    borderColor: BORDER,
    borderWidth: 1
  });

  columns.forEach((column) => {
    const value = typeof column.value === "function" ? column.value(row) : row[column.key];
    const text = truncate(value, column.maxChars || 48);
    const usedY = drawWrappedText(page, fonts.regular, text, currentX + 6, y + 8, 8, column.width - 12, 2);
    minY = Math.min(minY, usedY);
    currentX += column.width;
  });

  return minY - 16;
}

function drawChart(page, fonts, title, points, y) {
  const chartHeight = 170;
  const chartWidth = PAGE_WIDTH - MARGIN * 2 - 40;
  const originX = MARGIN + 28;
  const originY = y - chartHeight;
  const maxValue = Math.max(...points.map((point) => Number(point.value || 0)), 1);

  drawText(page, fonts.bold, title, MARGIN, y + 18, 13);
  page.drawRectangle({
    x: MARGIN,
    y: originY - 26,
    width: PAGE_WIDTH - MARGIN * 2,
    height: chartHeight + 52,
    color: WHITE,
    borderColor: BORDER,
    borderWidth: 1
  });

  page.drawLine({
    start: { x: originX, y: originY },
    end: { x: originX + chartWidth, y: originY },
    color: BORDER,
    thickness: 1
  });

  page.drawLine({
    start: { x: originX, y: originY },
    end: { x: originX, y: originY + chartHeight },
    color: BORDER,
    thickness: 1
  });

  const barWidth = Math.max(26, Math.min(56, chartWidth / Math.max(points.length * 1.6, 1)));
  const gap = points.length > 1 ? (chartWidth - barWidth * points.length) / (points.length - 1) : 0;

  points.forEach((point, index) => {
    const value = Number(point.value || 0);
    const height = (value / maxValue) * (chartHeight - 24);
    const x = originX + index * (barWidth + gap);

    page.drawRectangle({
      x,
      y: originY,
      width: barWidth,
      height,
      color: ACCENT
    });

    drawText(page, fonts.regular, truncate(point.label, 12), x, originY - 16, 7, SOFT);
    drawText(page, fonts.bold, money(value), x, originY + height + 6, 7, BLACK);
  });

  return originY - 42;
}

export async function buildReportPdf({
  title,
  subtitle,
  summary,
  columns,
  rows,
  chartTitle,
  chartPoints
}) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - 48;

  drawHeader(page, fonts, title, subtitle);
  cursorY = drawSummary(page, fonts, summary);
  cursorY = drawTableHeader(page, fonts, columns, cursorY);

  for (const row of rows) {
    if (cursorY < 82) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(page, fonts, title, subtitle);
      cursorY = PAGE_HEIGHT - 110;
      cursorY = drawTableHeader(page, fonts, columns, cursorY);
    }

    cursorY = drawRow(page, fonts, columns, row, cursorY);
  }

  if (chartTitle && Array.isArray(chartPoints) && chartPoints.length > 0) {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, fonts, title, subtitle);
    drawChart(page, fonts, chartTitle, chartPoints, PAGE_HEIGHT - 120);
  }

  return Buffer.from(await pdf.save());
}

export { money, formatDate };
