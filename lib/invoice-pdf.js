import { readFileSync } from "node:fs";
import path from "node:path";
import { gerarPDF as gerarDanfePdfKit } from "@alexssmusica/node-pdf-nfe";
import { XMLBuilder } from "fast-xml-parser";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const TEMPLATE_BYTES = readFileSync(path.join(process.cwd(), "lib", "danfe-template.pdf"));
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: false,
  format: false
});

function safeText(value, fallback = "") {
  return String(value ?? fallback).trim() || fallback;
}

function onlyDigits(value) {
  return safeText(value).replace(/\D/g, "");
}

function formatDocument(value) {
  const digits = onlyDigits(value);

  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }

  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }

  return safeText(value, "");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDecimal(value, digits) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function splitAccessKey(value) {
  const digits = onlyDigits(value);
  return digits ? digits.match(/.{1,4}/g)?.join(" ") || digits : "";
}

function fitText(font, text, size, maxWidth) {
  let currentSize = size;

  while (currentSize > 4.5 && font.widthOfTextAtSize(text, currentSize) > maxWidth) {
    currentSize -= 0.2;
  }

  return currentSize;
}

function readInvoiceMeta(invoice) {
  if (!invoice?.invoice_meta) {
    return {};
  }

  try {
    return typeof invoice.invoice_meta === "string" ? JSON.parse(invoice.invoice_meta) : invoice.invoice_meta;
  } catch {
    return {};
  }
}

function getItems(invoice) {
  const meta = readInvoiceMeta(invoice);
  const rawItems = Array.isArray(meta.items) && meta.items.length > 0
    ? meta.items
    : meta.item
      ? [meta.item]
      : [];

  return rawItems.map((item, index) => ({
    code: safeText(item.productCode || item.sku || item.codigo, String(index + 1)),
    description: safeText(item.description || item.name || "Produto"),
    ncm: safeText(item.classFiscal || item.ncm || "00000000"),
    csosn: safeText(item.st || item.csosn || "010"),
    cfop: safeText(item.cfop || meta.cfopCode || "5102"),
    unit: safeText(item.unit || "UN"),
    quantity: Number(item.quantity || 0),
    unitValue: Number(item.unitValue || 0),
    totalValue: Number(item.subtotalValue || Number(item.quantity || 0) * Number(item.unitValue || 0)),
    baseIcms: Number(item.baseCalcValue || 0),
    icmsValue: Number(item.icmsValue || 0),
    ipiValue: Number(item.ipiValue || 0),
    icmsAliquot: Number(item.icmsAliquot || 0),
    ipiAliquot: Number(item.ipiAliquot || 0),
    discountValue: Number(item.discountValue || 0)
  }));
}

function getAdditionalInfo(invoice) {
  const meta = readInvoiceMeta(invoice);
  const parts = [];
  const normalizedNotes = safeText(invoice.notes);

  if (normalizedNotes) {
    parts.push(normalizedNotes);
  }

  parts.push("Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de ICMS, ISS, IPI.");

  if (meta.funruralMode && meta.funruralMode !== "nao_desconta_nao_informa") {
    parts.push(
      `Desconto Funrural : ${formatCurrency(meta.funruralPercent || 0)}% FUNRURAL ${safeText(meta.funruralMode).replace(/_/g, " ").toUpperCase()}`
    );
  }

  return parts.join(" ");
}

function wrapText(text, font, size, maxWidth, maxLines) {
  const words = safeText(text).split(/\s+/).filter(Boolean);

  if (!words.length) {
    return [""];
  }

  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    let finalLine = current;

    while (font.widthOfTextAtSize(finalLine, size) > maxWidth && finalLine.length > 3) {
      finalLine = `${finalLine.slice(0, -4)}...`;
    }

    lines.push(finalLine);
  }

  return lines.slice(0, maxLines);
}

function paint(page, x, y, width, height) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: WHITE
  });
}

function write(page, font, text, x, y, size, options = {}) {
  const normalized = safeText(text);

  if (!normalized) {
    return;
  }

  const finalSize = options.maxWidth ? fitText(font, normalized, size, options.maxWidth) : size;
  page.drawText(normalized, {
    x,
    y,
    size: finalSize,
    font,
    color: options.color || BLACK
  });
}

function drawLines(page, font, text, x, y, size, maxWidth, maxLines, lineGap = 10) {
  const lines = wrapText(text, font, size, maxWidth, maxLines);

  lines.forEach((line, index) => {
    write(page, font, line, x, y - (index * lineGap), size, { maxWidth });
  });
}

function getInvoiceXml(invoice) {
  const source = invoice?.signed_xml_data || invoice?.xml_file_data;

  if (!source) {
    throw new Error("A nota ainda nao possui XML para gerar a DANFE.");
  }

  const xml = Buffer.isBuffer(source) ? source.toString("utf-8") : String(source);

  if (!xml.trim()) {
    throw new Error("O XML da nota fiscal esta vazio.");
  }

  return xml;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function decimalXml(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function formatXmlDateTime(value) {
  if (!value) {
    return new Date().toISOString().replace(".000Z", "-03:00");
  }

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00-03:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return /([+-]\d{2}:\d{2}|Z)$/.test(raw) ? raw.replace("Z", "-03:00") : `${raw}-03:00`;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace(".000Z", "-03:00");
  }

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}-03:00`;
}

function buildDestDocumentNode(document) {
  const digits = onlyDigits(document);
  return digits.length === 11 ? { CPF: digits } : { CNPJ: digits };
}

function buildDanfeXmlFromContext({ company, customer, invoice }) {
  const meta = readInvoiceMeta(invoice);
  const items = getItems(invoice);
  const accessKey = safeText(invoice.access_key || invoice.generated_access_key);
  const companyCityCode = onlyDigits(company.city_code) || "3550308";
  const customerCityCode = onlyDigits(customer.city_code) || companyCityCode;
  const issueDateTime = formatXmlDateTime(invoice.issue_date || invoice.created_at || invoice.sent_at);
  const exitDateTime = formatXmlDateTime(meta.dispatchDate || invoice.issue_date || invoice.created_at || invoice.sent_at);
  const receiptDateTime = formatXmlDateTime(invoice.sent_at || invoice.created_at || invoice.issue_date);
  const totalProducts = items.reduce((sum, item) => sum + Number(item.totalValue || 0), 0);
  const totalValue = Number(invoice.total_value || meta.totalInvoiceValue || totalProducts || 0);
  const transport = meta.transport || {};
  const paymentMethod = safeText(meta.paymentMethod, "90");
  const installments = Array.isArray(meta.installments) ? meta.installments : [];
  const protocolNumber = safeText(invoice.protocol_number);
  const environment = invoice.environment_mode === "producao" ? "1" : "2";
  const customerDoc = buildDestDocumentNode(customer.document);
  const destIe = safeText(customer.state_registration);
  const companyDoc = onlyDigits(company.cnpj);
  const det = items.map((item, index) => ({
    "@_nItem": String(index + 1),
    prod: {
      cProd: safeText(item.code, String(index + 1)),
      cEAN: "SEM GTIN",
      xProd: safeText(item.description, "Produto"),
      NCM: safeText(item.ncm, "00000000"),
      CFOP: safeText(item.cfop, safeText(meta.cfopCode, "5102")),
      uCom: safeText(item.unit, "UN"),
      qCom: decimalXml(item.quantity, 4),
      vUnCom: money(item.unitValue),
      vProd: money(item.totalValue),
      cEANTrib: "SEM GTIN",
      uTrib: safeText(item.unit, "UN"),
      qTrib: decimalXml(item.quantity, 4),
      vUnTrib: money(item.unitValue),
      indTot: "1"
    },
    imposto: {
      ICMS: {
        ICMS00: {
          orig: "0",
          CST: "00",
          modBC: "3",
          vBC: money(item.baseIcms || item.totalValue),
          pICMS: money(item.icmsAliquot),
          vICMS: money(item.icmsValue)
        }
      },
      IPI: {
        cEnq: "999",
        IPITrib: {
          CST: "99",
          vBC: money(item.totalValue),
          pIPI: money(item.ipiAliquot),
          vIPI: money(item.ipiValue)
        }
      },
      PIS: {
        PISNT: {
          CST: "07"
        }
      },
      COFINS: {
        COFINSNT: {
          CST: "07"
        }
      }
    }
  }));

  const xmlObject = {
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8"
    },
    nfeProc: {
      "@_versao": "4.00",
      NFe: {
        infNFe: {
          "@_versao": "4.00",
          "@_Id": accessKey ? `NFe${accessKey}` : undefined,
          ide: {
            cUF: safeText(company.state === "SP" ? "35" : "35"),
            cNF: accessKey ? accessKey.slice(-9, -1) : String(Date.now()).slice(-8),
            natOp: safeText(meta.nature, "Venda"),
            mod: "55",
            serie: safeText(invoice.series, "1"),
            nNF: safeText(invoice.number, "1"),
            dhEmi: issueDateTime,
            dhSaiEnt: exitDateTime,
            tpNF: meta.nfType === "entrada" ? "0" : "1",
            idDest: "1",
            cMunFG: companyCityCode,
            tpImp: "1",
            tpEmis: "1",
            cDV: accessKey ? accessKey.slice(-1) : "0",
            tpAmb: environment,
            finNFe: "1",
            indFinal: "1",
            indPres: safeText(meta.buyerPresence, "1"),
            procEmi: "0",
            verProc: "Portal Fiscal"
          },
          emit: {
            CNPJ: companyDoc,
            xNome: safeText(company.legal_name),
            xFant: safeText(company.trade_name || company.legal_name),
            enderEmit: {
              xLgr: safeText(company.address_line || company.address, "Nao informado"),
              nro: safeText(company.address_number, "S/N"),
              xCpl: safeText(company.address_complement),
              xBairro: safeText(company.district, "Nao informado"),
              cMun: companyCityCode,
              xMun: safeText(company.city, "Nao informado"),
              UF: safeText(company.state, "SP"),
              CEP: onlyDigits(company.zip_code) || "00000000",
              cPais: onlyDigits(company.country_code) || "1058",
              xPais: safeText(company.country_name, "Brasil"),
              fone: onlyDigits(company.phone)
            },
            IE: safeText(company.state_registration, "ISENTO"),
            CRT: safeText(company.tax_regime, "3")
          },
          dest: {
            ...customerDoc,
            xNome: safeText(customer.full_name, "Cliente"),
            enderDest: {
              xLgr: safeText(customer.address_line || customer.address, "Nao informado"),
              nro: safeText(customer.address_number, "S/N"),
              xCpl: safeText(customer.address_complement),
              xBairro: safeText(customer.district, "Nao informado"),
              cMun: customerCityCode,
              xMun: safeText(customer.city, "Nao informado"),
              UF: safeText(customer.state, "SP"),
              CEP: onlyDigits(customer.zip_code) || "00000000",
              cPais: onlyDigits(customer.country_code) || "1058",
              xPais: safeText(customer.country_name, "Brasil"),
              fone: onlyDigits(customer.phone)
            },
            indIEDest: destIe ? "1" : "9",
            IE: destIe || undefined,
            email: safeText(customer.email)
          },
          det,
          total: {
            ICMSTot: {
              vBC: money(meta.baseCalcValue),
              vICMS: money(meta.icmsValue),
              vICMSDeson: "0.00",
              vFCP: "0.00",
              vBCST: money(meta.baseCalcStValue),
              vST: money(meta.icmsStValue),
              vFCPST: "0.00",
              vFCPSTRet: "0.00",
              vProd: money(meta.totalProductsValue || totalProducts),
              vFrete: money(meta.freightValue),
              vSeg: money(meta.insuranceValue),
              vDesc: money(meta.discountValue),
              vII: "0.00",
              vIPI: money(meta.ipiValue),
              vIPIDevol: "0.00",
              vPIS: "0.00",
              vCOFINS: "0.00",
              vOutro: money(meta.otherValue),
              vNF: money(totalValue)
            }
          },
          transp: {
            modFrete: safeText(transport.freightMode || transport.code, "9"),
            transporta: transport.name ? {
              xNome: safeText(transport.name),
              xEnder: safeText(transport.address),
              xMun: safeText(transport.city),
              UF: safeText(transport.state, "SP"),
              CNPJ: onlyDigits(transport.cnpj) || undefined,
              IE: safeText(transport.stateRegistration)
            } : undefined,
            vol: {
              qVol: safeText(transport.quantity, "1"),
              esp: safeText(transport.specie, "VOLUME"),
              marca: safeText(transport.brand),
              pesoL: money(transport.netWeight),
              pesoB: money(transport.grossWeight)
            }
          },
          cobr: installments.length > 0 ? {
            dup: installments.map((installment, index) => ({
              nDup: safeText(installment.parcela, `${invoice.number}-${index + 1}`),
              dVenc: safeText(installment.vencimento, String(invoice.issue_date || "").slice(0, 10)),
              vDup: money(installment.valor)
            }))
          } : undefined,
          pag: {
            detPag: {
              tPag: paymentMethod,
              vPag: money(totalValue)
            }
          },
          infAdic: {
            infCpl: getAdditionalInfo(invoice)
          }
        }
      },
      protNFe: {
        "@_versao": "4.00",
        infProt: {
          tpAmb: environment,
          verAplic: "Portal Fiscal",
          chNFe: accessKey,
          dhRecbto: receiptDateTime,
          nProt: protocolNumber || "0",
          cStat: protocolNumber ? "100" : "0",
          xMotivo: protocolNumber ? "Autorizado o uso da NF-e" : safeText(invoice.status, "XML gerado")
        }
      }
    }
  };

  return xmlBuilder.build(xmlObject);
}

function pdfKitDocumentToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    doc.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.once("error", reject);
    doc.end();
  });
}

async function generateComponentDanfe(context) {
  const sourceXml = getInvoiceXml(context.invoice);
  const xml = /<nfeProc[\s>]/i.test(sourceXml) ? sourceXml : buildDanfeXmlFromContext(context);
  const doc = await gerarDanfePdfKit(xml, { notEndDocument: true });
  return pdfKitDocumentToBuffer(doc);
}

async function generateTemplateDanfe({ company, customer, invoice }) {
  const pdf = await PDFDocument.create();
  const template = await PDFDocument.load(TEMPLATE_BYTES);
  const [templatePage] = await pdf.copyPages(template, [0]);
  const page = pdf.addPage(templatePage);
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold)
  };
  const meta = readInvoiceMeta(invoice);
  const items = getItems(invoice);
  const emission = formatDate(invoice.issue_date || invoice.created_at || invoice.sent_at);
  const totalValue = formatCurrency(invoice.total_value || 0);
  const number = safeText(invoice.number, "0").padStart(9, "0");
  const series = safeText(invoice.series, "1").padStart(3, "0");
  const accessKey = invoice.access_key || invoice.generated_access_key || "";
  const emitterAddress = `${safeText(company.address_line || company.address)} ${safeText(company.address_number)} ${safeText(company.address_complement)}`.replace(/\s+/g, " ").trim();
  const emitterDistrictCity = `${safeText(company.district)} - ${safeText(company.city)} - ${safeText(company.state)} - CEP:${safeText(company.zip_code)}`.replace(/\s+/g, " ").trim();
  const customerAddress = `${safeText(customer.address_line || customer.address)}${safeText(customer.address_number) ? `, ${safeText(customer.address_number)}` : ""}${safeText(customer.address_complement) ? ` ${safeText(customer.address_complement)}` : ""}`.trim();
  const operationNature = safeText(meta.nature, "VENDA DENTRO DO ESTADO");
  const transport = meta.transport || {};

  paint(page, 100, 796, 392, 13);
  write(page, fonts.regular, `EMISSAO: ${emission}  -  DEST. / REM.: ${safeText(customer.full_name, "CLIENTE")}  -  VALOR TOTAL: R$ ${totalValue}`, 102.75, 806.25, 6, { maxWidth: 387 });
  paint(page, 494, 784, 74, 31);
  write(page, fonts.bold, `Nº ${number.slice(0, 3)}.${number.slice(3, 6)}.${number.slice(6)}`, 495, 798.75, 10);
  write(page, fonts.bold, `SÉRIE ${series}`, 504, 786, 10);
  paint(page, 24, 680, 196, 43);
  write(page, fonts.bold, safeText(company.legal_name, "EMITENTE"), 59.25, 716.25, 8, { maxWidth: 154 });
  write(page, fonts.regular, emitterAddress, 25.5, 701.25, 7, { maxWidth: 190 });
  write(page, fonts.regular, emitterDistrictCity, 25.5, 692.25, 7, { maxWidth: 190 });
  write(page, fonts.regular, `TEL: ${safeText(company.phone)}`, 25.5, 683.25, 7, { maxWidth: 190 });
  paint(page, 225, 683, 88, 34);
  write(page, fonts.bold, `Nº ${number.slice(0, 3)}.${number.slice(3, 6)}.${number.slice(6)}`, 227.25, 697.5, 10);
  write(page, fonts.bold, `SÉRIE ${series}`, 263.25, 685.5, 10);
  paint(page, 364, 708, 183, 8);
  write(page, fonts.bold, splitAccessKey(accessKey), 367.5, 715.5, 7, { maxWidth: 175 });
  paint(page, 345, 637, 197, 13);
  write(page, fonts.regular, `${safeText(invoice.protocol_number)} ${formatDateTime(invoice.sent_at || invoice.issue_date || invoice.created_at)}`.trim(), 349, 638.25, 8, { maxWidth: 190 });
  paint(page, 24, 657, 174, 12);
  write(page, fonts.regular, operationNature, 25.5, 660.75, 8, { maxWidth: 168 });
  paint(page, 24, 635, 104, 12);
  write(page, fonts.regular, safeText(company.state_registration, "ISENTO"), 25.5, 638.25, 8, { maxWidth: 100 });
  paint(page, 394, 635, 147, 12);
  write(page, fonts.regular, formatDocument(company.cnpj), 394.5, 638.25, 8, { maxWidth: 145 });
  paint(page, 24, 600, 384, 12);
  write(page, fonts.regular, safeText(customer.full_name), 25.5, 603, 8, { maxWidth: 378 });
  paint(page, 421, 600, 83, 12);
  write(page, fonts.regular, formatDocument(customer.document), 422.25, 603, 8, { maxWidth: 80 });
  paint(page, 510, 600, 54, 12);
  write(page, fonts.regular, emission, 510.75, 603, 8, { maxWidth: 50 });
  paint(page, 24, 578, 300, 12);
  write(page, fonts.regular, customerAddress, 25.5, 580.5, 8, { maxWidth: 294 });
  paint(page, 332, 578, 114, 12);
  write(page, fonts.regular, safeText(customer.district), 333, 580.5, 8, { maxWidth: 108 });
  paint(page, 458, 578, 48, 12);
  write(page, fonts.regular, safeText(customer.zip_code), 459, 580.5, 8, { maxWidth: 44 });
  paint(page, 510, 578, 54, 12);
  write(page, fonts.regular, emission, 510.75, 580.5, 8, { maxWidth: 50 });
  paint(page, 24, 555, 228, 12);
  write(page, fonts.regular, safeText(customer.city), 25.5, 558, 8, { maxWidth: 223 });
  paint(page, 259, 555, 112, 12);
  write(page, fonts.regular, safeText(customer.phone), 259.5, 558, 8, { maxWidth: 108 });
  paint(page, 379, 555, 26, 12);
  write(page, fonts.regular, safeText(customer.state), 380.25, 558, 8, { maxWidth: 22 });
  paint(page, 417, 555, 82, 12);
  write(page, fonts.regular, safeText(customer.state_registration), 417, 558, 8, { maxWidth: 78 });

  const taxValues = [
    { x: 102.75, y: 524.25, value: formatCurrency(meta.baseCalcValue || 0), width: 36 },
    { x: 210.75, y: 524.25, value: formatCurrency(meta.icmsValue || 0), width: 36 },
    { x: 318.75, y: 524.25, value: formatCurrency(meta.baseCalcStValue || 0), width: 36 },
    { x: 426.75, y: 524.25, value: formatCurrency(meta.icmsStValue || 0), width: 36 },
    { x: 541.5, y: 524.25, value: formatCurrency(meta.totalProductsValue || invoice.total_value || 0), width: 40 },
    { x: 80.25, y: 501.75, value: formatCurrency(meta.freightValue || 0), width: 36 },
    { x: 168, y: 501.75, value: formatCurrency(meta.insuranceValue || 0), width: 36 },
    { x: 255, y: 501.75, value: formatCurrency(meta.discountValue || 0), width: 36 },
    { x: 342, y: 501.75, value: formatCurrency(meta.otherValue || 0), width: 36 },
    { x: 426.75, y: 501.75, value: formatCurrency(meta.ipiValue || 0), width: 36 },
    { x: 541.5, y: 501.75, value: formatCurrency(invoice.total_value || 0), width: 40 }
  ];

  [
    [96, 521, 58, 12], [204, 521, 58, 12], [312, 521, 58, 12], [420, 521, 58, 12], [499, 521, 63, 12],
    [72, 498, 55, 12], [160, 498, 55, 12], [247, 498, 55, 12], [334, 498, 55, 12], [420, 498, 55, 12], [499, 498, 63, 12]
  ].forEach(([x, y, width, height]) => paint(page, x, y, width, height));
  taxValues.forEach(({ x, y, value, width }) => write(page, fonts.regular, value, x, y, 8, { maxWidth: width }));

  [
    [24, 465, 214, 12], [262, 465, 69, 12], [398, 465, 58, 12], [458, 465, 22, 12], [484, 465, 77, 12],
    [24, 443, 273, 12], [308, 443, 144, 12], [458, 443, 22, 12], [484, 443, 77, 12],
    [74, 420, 18, 12], [93, 420, 93, 12], [192, 420, 92, 12], [289, 420, 92, 12], [388, 420, 86, 12], [484, 420, 78, 12]
  ].forEach(([x, y, width, height]) => paint(page, x, y, width, height));
  write(page, fonts.regular, safeText(transport.name), 25.5, 468, 8, { maxWidth: 210 });
  write(page, fonts.regular, safeText(transport.address), 25.5, 445.5, 8, { maxWidth: 268 });
  write(page, fonts.regular, safeText(transport.city), 307.5, 445.5, 8, { maxWidth: 140 });
  write(page, fonts.regular, safeText(transport.state), 458.25, 445.5, 8, { maxWidth: 20 });
  write(page, fonts.regular, safeText(transport.stateRegistration), 483.75, 445.5, 8, { maxWidth: 74 });
  write(page, fonts.regular, safeText(transport.quantity, "1"), 75, 423, 8, { maxWidth: 16 });
  write(page, fonts.regular, safeText(transport.specie, "VOLUME"), 93.75, 423, 8, { maxWidth: 90 });

  paint(page, 19, 145, 565, 249);
  items.slice(0, 28).forEach((item, index) => {
    const y = 388.5 - (index * 9);
    write(page, fonts.regular, item.code, 20.25, y, 6, { maxWidth: 40 });
    write(page, fonts.regular, item.description, 63, y, 6, { maxWidth: 136 });
    write(page, fonts.regular, item.ncm, 203.25, y, 6, { maxWidth: 30 });
    write(page, fonts.regular, item.csosn, 234.75, y, 6, { maxWidth: 24 });
    write(page, fonts.regular, item.cfop, 262.5, y, 6, { maxWidth: 24 });
    write(page, fonts.regular, item.unit, 289.5, y, 6, { maxWidth: 18 });
    write(page, fonts.regular, formatDecimal(item.quantity, 4), 311.25, y, 6, { maxWidth: 32 });
    write(page, fonts.regular, formatDecimal(item.unitValue, 7), 345, y, 6, { maxWidth: 45 });
    write(page, fonts.regular, formatCurrency(item.totalValue), 393.75, y, 6, { maxWidth: 31 });
  });

  paint(page, 24, 97, 403, 24);
  drawLines(page, fonts.regular, getAdditionalInfo(invoice), 25.5, 112.5, 8, 398, 2, 10.5);
  paint(page, 428, 97, 134, 24);
  write(page, fonts.regular, accessKey, 430, 112.5, 6.5, { maxWidth: 128 });

  return Buffer.from(await pdf.save());
}

export async function generateInvoicePdf(context) {
  try {
    return await generateComponentDanfe(context);
  } catch {
    getInvoiceXml(context.invoice);
    return generateTemplateDanfe(context);
  }
}
