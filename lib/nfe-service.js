import { readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { NFE_EXTRA_CA_BUNDLE } from "./nfe-ca.js";
import { decryptSecretBuffer, decryptSecretText } from "./security.js";

const UF_CODE = {
  AC: 12,
  AL: 27,
  AP: 16,
  AM: 13,
  BA: 29,
  CE: 23,
  DF: 53,
  ES: 32,
  GO: 52,
  MA: 21,
  MT: 51,
  MS: 50,
  MG: 31,
  PA: 15,
  PB: 25,
  PR: 41,
  PE: 26,
  PI: 22,
  RJ: 33,
  RN: 24,
  RS: 43,
  RO: 11,
  RR: 14,
  SC: 42,
  SP: 35,
  SE: 28,
  TO: 17
};

let forgeDerCompatibilityPatched = false;
let certificateLoaderPatched = false;
const require = createRequire(import.meta.url);

function getNfeCertificateAuthorities(certsDir) {
  const fallbackCas = [...NFE_EXTRA_CA_BUNDLE];

  if (!certsDir) {
    return fallbackCas;
  }

  try {
    const dynamicCas = readdirSync(certsDir)
      .filter((fileName) => !fileName.startsWith("."))
      .map((fileName) => readFileSync(path.join(certsDir, fileName), "utf-8"));

    if (dynamicCas.length === 0) {
      return fallbackCas;
    }

    return [...new Set([...dynamicCas, ...fallbackCas])];
  } catch {
    return fallbackCas;
  }
}

function disableSchemaValidation(wizard) {
  const utility = wizard?.nfeWizardService?.utility;

  if (!utility) {
    return;
  }

  const bypassValidation = async () => ({
    success: true,
    message: "Validacao de schema ignorada no runtime atual."
  });

  utility.validateSchemaJsBased = bypassValidation;
  utility.validateSchemaJavaBased = bypassValidation;
}

async function ensureForgeDerCompatibility() {
  if (forgeDerCompatibilityPatched) {
    return;
  }

  const { default: forge } = await import("node-forge");
  const originalFromDer = forge.asn1.fromDer.bind(forge.asn1);

  forge.asn1.fromDer = (bytes, options) => {
    try {
      return originalFromDer(bytes, options);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Unparsed DER bytes remain after ASN.1 parsing.")
      ) {
        return originalFromDer(bytes, {
          strict: false,
          parseAllBytes: false,
          decodeBitStrings: true
        });
      }

      throw error;
    }
  };

  forgeDerCompatibilityPatched = true;
}

async function patchNfeWizardCertificateLoader() {
  if (certificateLoaderPatched) {
    return;
  }

  const [{ default: forge }, shared] = await Promise.all([
    import("node-forge"),
    import("@nfewizard/shared")
  ]);

  const { LoadCertificate } = shared;

  if (!LoadCertificate?.prototype) {
    return;
  }

  let certsDir = null;

  try {
    const sharedEntryPath = require.resolve("@nfewizard/shared");

    if (typeof sharedEntryPath === "string") {
      const sharedRootDir = path.resolve(path.dirname(sharedEntryPath), "..");
      const candidate = path.join(sharedRootDir, "resources", "certs");
      certsDir = candidate;
    }
  } catch {
    certsDir = null;
  }

  LoadCertificate.prototype.loadCertificateWithNodeForge = function loadCertificateWithNodeForgePatched() {
    return new Promise((resolve, reject) => {
      try {
        const pfxPath = this.config.dfe.pathCertificado;
        const pfxPassword = this.config.dfe.senhaCertificado;
        const pfxFile = readFileSync(pfxPath);
        const p12Asn1 = forge.asn1.fromDer(pfxFile.toString("binary"));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pfxPassword);
        const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
        const certificates = certBags[forge.pki.oids.certBag] || [];
        const cert = certificates[0]?.cert;

        if (!key) {
          return reject(new Error("Erro ao carregar chave privada do certificado."));
        }

        if (!cert) {
          return reject(new Error("Erro ao validar certificado."));
        }

        const keyPem = forge.pki.privateKeyToPem(key);
        const certificateChainPem = certificates
          .map((entry) => entry?.cert)
          .filter(Boolean)
          .map((entry) => forge.pki.certificateToPem(entry))
          .join("\n");
        const certPem = forge.pki.certificateToPem(cert);
        const certForge = forge.pki.certificateFromPem(certPem);
        const now = new Date();

        if (now < certForge.validity.notBefore || now > certForge.validity.notAfter) {
          return reject(new Error("Erro ao carregar o certificado: O certificado fornecido expirou ou ainda nao e valido."));
        }

        this.certificate = certPem;
        this.cert_key = keyPem;

        const agentOptions = {
          key: keyPem,
          cert: certificateChainPem || certPem
        };

        const extraCas = getNfeCertificateAuthorities(certsDir);

        if (extraCas.length > 0) {
          agentOptions.ca = [...tls.rootCertificates, ...extraCas];
        }

        if (this.config.dfe.ambiente === 2) {
          agentOptions.rejectUnauthorized = false;
        }

        const agent = new https.Agent(agentOptions);

        resolve({
          success: true,
          agent,
          message: "Certificado carregado com sucesso."
        });
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : String(error)));
      }
    });
  };

  certificateLoaderPatched = true;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function clean(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value || "").trim();
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function money(value, fallback = "0.00") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : fallback;
}

function decimal(value, size = 4, fallback = "0.0000") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(size) : fallback;
}

function buildAdditionalInfo(notes, meta) {
  const baseNotes = clean(notes);
  const shouldInformFunrural = clean(meta.funruralMode) === "desconta_informa";
  const funruralValue = Number(meta.funruralValue || 0);

  if (!shouldInformFunrural || funruralValue <= 0) {
    return baseNotes || "Nota emitida pelo Portal Fiscal.";
  }

  const funruralText = `Funrural descontado a ${money(meta.funruralPercent || 0)}% no valor de R$ ${money(funruralValue)}.`;
  return baseNotes ? `${baseNotes} ${funruralText}` : funruralText;
}

function nowWithTimezone() {
  const now = new Date();
  const timezoneOffset = -3;
  const date = new Date(now.getTime() + timezoneOffset * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 19)}-03:00`;
}

function buildDateTime(date, time = "00:00") {
  const normalizedDate = clean(date);
  const normalizedTime = clean(time) || "00:00";

  if (!normalizedDate) {
    return nowWithTimezone();
  }

  return `${normalizedDate}T${normalizedTime}:00-03:00`;
}

function mapPaymentType(paymentType) {
  const source = clean(paymentType).toLowerCase();

  if (source.includes("pix")) return "17";
  if (source.includes("boleto")) return "15";
  if (source.includes("debito")) return "04";
  if (source.includes("credito")) return "03";
  if (source.includes("dinheiro")) return "01";
  if (source.includes("transfer")) return "16";

  return "99";
}

function getEnvironmentCode(mode) {
  return mode === "producao" ? 1 : 2;
}

function getCityCode(record, label) {
  const digits = onlyDigits(record.city_code);

  if (!digits) {
    throw new Error(`${label}: informe o codigo IBGE do municipio.`);
  }

  return Number(digits);
}

function requireFields(record, fields, label) {
  const missing = fields
    .filter(([key]) => !clean(record[key]))
    .map(([, description]) => description);

  if (missing.length > 0) {
    throw new Error(`${label}: faltam ${missing.join(", ")}.`);
  }
}

async function prepareTempPaths(companyId, invoiceId) {
  const baseDir = path.join(os.tmpdir(), "portal-fiscal", String(companyId), String(invoiceId));
  const certDir = path.join(baseDir, "cert");
  const xmlDir = path.join(baseDir, "xml");
  const logDir = path.join(baseDir, "logs");

  await Promise.all([
    mkdir(certDir, { recursive: true }),
    mkdir(xmlDir, { recursive: true }),
    mkdir(logDir, { recursive: true })
  ]);

  return { baseDir, certDir, xmlDir, logDir };
}

async function writeCertificate(company, certDir) {
  if (!company.certificate_data || !company.certificate_password) {
    throw new Error("A empresa precisa ter certificado A1 (.pfx/.p12) e senha cadastrados.");
  }

  const fileName = company.certificate_name || `company-${company.id}.pfx`;
  const certificatePath = path.join(certDir, fileName);
  let certificateBuffer;

  try {
    certificateBuffer = decryptSecretBuffer(company.certificate_data);
  } catch {
    throw new Error("Nao foi possivel ler o certificado digital da empresa. Revise o cadastro do certificado e salve novamente.");
  }

  if (!certificateBuffer) {
    throw new Error("Nao foi possivel descriptografar o certificado digital da empresa.");
  }

  await writeFile(certificatePath, certificateBuffer);

  return certificatePath;
}

function buildEmitter(company) {
  requireFields(
    company,
    [
      ["legal_name", "razao social"],
      ["cnpj", "cnpj"],
      ["state_registration", "inscricao estadual"],
      ["address_line", "logradouro"],
      ["address_number", "numero"],
      ["district", "bairro"],
      ["city", "cidade"],
      ["state", "uf"],
      ["zip_code", "cep"],
      ["city_code", "codigo IBGE"],
      ["tax_regime", "regime tributario"]
    ],
    "Empresa"
  );

  return {
    CNPJCPF: onlyDigits(company.cnpj),
    xNome: clean(company.legal_name),
    xFant: clean(company.trade_name) || clean(company.legal_name),
    enderEmit: {
      xLgr: clean(company.address_line),
      nro: clean(company.address_number),
      ...(clean(company.address_complement) ? { xCpl: clean(company.address_complement) } : {}),
      xBairro: clean(company.district),
      cMun: getCityCode(company, "Empresa"),
      xMun: clean(company.city),
      UF: clean(company.state).toUpperCase(),
      CEP: onlyDigits(company.zip_code),
      cPais: asNumber(onlyDigits(company.country_code), 1058),
      xPais: clean(company.country_name) || "Brasil",
      fone: onlyDigits(company.phone) || undefined
    },
    IE: onlyDigits(company.state_registration),
    CRT: asNumber(company.tax_regime, 3)
  };
}

function buildRecipient(customer) {
  requireFields(
    customer,
    [
      ["full_name", "nome/razao social"],
      ["document", "cpf/cnpj"],
      ["address_line", "logradouro"],
      ["address_number", "numero"],
      ["district", "bairro"],
      ["city", "cidade"],
      ["state", "uf"],
      ["zip_code", "cep"],
      ["city_code", "codigo IBGE"]
    ],
    "Cliente"
  );

  const document = onlyDigits(customer.document);
  const isCompany = document.length > 11;
  const stateRegistration = onlyDigits(customer.state_registration);

  return {
    CNPJCPF: document,
    xNome: clean(customer.full_name),
    enderDest: {
      xLgr: clean(customer.address_line),
      nro: clean(customer.address_number),
      ...(clean(customer.address_complement) ? { xCpl: clean(customer.address_complement) } : {}),
      xBairro: clean(customer.district),
      cMun: getCityCode(customer, "Cliente"),
      xMun: clean(customer.city),
      UF: clean(customer.state).toUpperCase(),
      CEP: onlyDigits(customer.zip_code),
      cPais: asNumber(onlyDigits(customer.country_code), 1058),
      xPais: clean(customer.country_name) || "Brasil",
      fone: onlyDigits(customer.phone) || undefined
    },
    indIEDest: stateRegistration ? 1 : 9,
    IE: stateRegistration || undefined,
    email: clean(customer.email) || undefined
  };
}

function buildTransport(meta) {
  const transport = meta.transport || {};
  const modFrete = Number.parseInt(clean(transport.freightMode || transport.code), 10);
  const hasCarrier = clean(transport.name) || clean(transport.cnpj);
  const hasVehicle = clean(transport.plate);
  const hasVolume = clean(transport.quantity) || clean(transport.specie) || clean(transport.brand);

  return {
    modFrete: Number.isFinite(modFrete) ? modFrete : hasCarrier ? 0 : 9,
    ...(hasCarrier
      ? {
          transporta: {
          xNome: clean(transport.name) || undefined,
          xEnder: clean(transport.address) || undefined,
          xMun: clean(transport.city) || undefined,
          UF: clean(transport.state).toUpperCase() || undefined,
          CNPJCPF: onlyDigits(transport.cnpj || transport.document) || undefined,
          IE: onlyDigits(transport.stateRegistration) || undefined
        }
        }
      : {}),
    ...(hasVehicle
      ? {
          veicTransp: {
          placa: clean(transport.plate).toUpperCase(),
          UF: clean(transport.plateState).toUpperCase() || undefined
        }
        }
      : {}),
    ...(hasVolume
      ? {
          vol: {
          qVol: asNumber(transport.quantity, 0) || undefined,
          esp: clean(transport.specie) || undefined,
          marca: clean(transport.brand) || undefined,
          pesoB: clean(transport.grossWeight) || undefined,
          pesoL: clean(transport.netWeight) || undefined
        }
        }
      : {})
  };
}

function buildBilling(meta, totalValue) {
  const installments = Array.isArray(meta.installments) ? meta.installments.filter((item) => item.parcela || item.vencimento || item.valor) : [];
  const paymentCode = mapPaymentType(meta.paymentType || meta.paymentMethod);

  if (installments.length === 0) {
    return {
      cobr: undefined,
      pag: {
        detPag: {
          indPag: clean(meta.paymentMethod).toLowerCase().includes("prazo") ? 1 : 0,
          tPag: paymentCode,
          ...(paymentCode === "99" ? { xPag: clean(meta.paymentType || meta.paymentMethod) || "Outros" } : {}),
          vPag: money(totalValue)
        }
      }
    };
  }

  return {
    cobr: {
      fat: {
        nFat: `FAT-${clean(meta.number || "")}` || undefined,
        vOrig: Number(totalValue || 0),
        vDesc: Number(meta.discountValue || 0),
        vLiq: Number(totalValue || 0)
      },
      dup: installments.map((installment, index) => ({
        nDup: clean(installment.parcela) || String(index + 1),
        dVenc: clean(installment.vencimento) || undefined,
        vDup: Number(installment.valor || 0)
      }))
    },
    pag: {
      detPag: {
        indPag: 1,
        tPag: paymentCode,
        ...(paymentCode === "99" ? { xPag: clean(meta.paymentType || meta.paymentMethod) || "Outros" } : {}),
        vPag: money(totalValue)
      }
    }
  };
}

function buildItems(meta, product, products, totalValue, company) {
  const rawItems = Array.isArray(meta.items) && meta.items.length > 0
    ? meta.items
    : [meta.item || {}];
  const productsById = new Map((products || []).map((item) => [String(item.id), item]));
  const isSimplesNacional = [1, 4].includes(asNumber(company?.tax_regime, 0));
  const normalizedItems = rawItems.map((item, index) => {
    const linkedProduct = productsById.get(String(item.productId || "")) || (index === 0 ? product : null);
    const subtotalValue = Number(item.subtotalValue || asNumber(item.quantity, 1) * asNumber(item.unitValue, totalValue));
    const icmsAliquot = asNumber(item.icmsAliquot, 0);
    const ipiAliquot = asNumber(item.ipiAliquot, 0);
    const icmsItemValue = Number(item.icmsValue || (subtotalValue * icmsAliquot) / 100);
    const ipiItemValue = Number(item.ipiValue || (subtotalValue * ipiAliquot) / 100);

    return {
      raw: item,
      linkedProduct,
      subtotalValue,
      icmsAliquot,
      ipiAliquot,
      icmsItemValue,
      ipiItemValue
    };
  });
  const totalProducts = normalizedItems.reduce((sum, item) => sum + item.subtotalValue, 0);
  const totalIcms = normalizedItems.reduce((sum, item) => sum + item.icmsItemValue, 0);
  const totalIpi = normalizedItems.reduce((sum, item) => sum + item.ipiItemValue, 0);

  return {
    det: normalizedItems.map((item, index) => {
      const quantity = decimal(item.raw.quantity || 1, 4, "1.0000");
      const unitValue = money(item.raw.unitValue || item.linkedProduct?.price || 0);
      const subtotalValue = money(item.subtotalValue || totalValue);
      const cst = clean(item.raw.st) || "00";
      const icmsBlock = isSimplesNacional
        ? {
            ICMSSN102: {
              orig: 0,
              CSOSN: "102"
            }
          }
        : cst === "20"
          ? {
              ICMS20: {
                orig: 0,
                CST: "20",
                modBC: 3,
                pRedBC: "0.00",
                vBC: subtotalValue,
                pICMS: money(item.icmsAliquot || 0),
                vICMS: money(item.icmsItemValue || 0)
              }
            }
        : {
            ICMS00: {
              orig: 0,
              CST: "00",
              modBC: 3,
              vBC: subtotalValue,
              pICMS: money(item.icmsAliquot || 0),
              vICMS: money(item.icmsItemValue || 0)
            }
          };

      return {
        prod: {
          cProd: clean(item.raw.productCode) || clean(item.linkedProduct?.sku) || `ITEM${index + 1}`,
          cEAN: "SEM GTIN",
          xProd: clean(item.raw.description) || clean(item.linkedProduct?.name) || "Produto",
          NCM: clean(item.raw.classFiscal) || clean(item.linkedProduct?.ncm) || "00000000",
          CFOP: clean(item.raw.cfop) || clean(meta.cfopCode) || "5102",
          uCom: clean(item.raw.unit) || "UN",
          qCom: quantity,
          vUnCom: unitValue,
          vProd: subtotalValue,
          cEANTrib: "SEM GTIN",
          uTrib: clean(item.raw.unit) || "UN",
          qTrib: quantity,
          vUnTrib: unitValue,
          indTot: 1
        },
        imposto: {
          ICMS: icmsBlock,
          IPI: {
            cEnq: "999",
            IPITrib: {
              CST: "50",
              vBC: subtotalValue,
              pIPI: String(item.ipiAliquot || 0),
              vIPI: money(item.ipiItemValue || 0)
            }
          },
          PIS: {
            PISAliq: {
              CST: "01",
              vBC: subtotalValue,
              pPIS: "1.65",
              vPIS: money(Number(subtotalValue) * 0.0165)
            }
          },
          COFINS: {
            COFINSAliq: {
              CST: "01",
              vBC: subtotalValue,
              pCOFINS: "7.60",
              vCOFINS: money(Number(subtotalValue) * 0.076)
            }
          }
        },
        ...(clean(meta.notes) ? { infAdProd: clean(meta.notes) } : {})
      };
    }),
    total: {
      ICMSTot: {
        vBC: money(meta.baseCalcValue || 0),
        vICMS: money(meta.icmsValue || totalIcms),
        vICMSDeson: "0.00",
        vFCP: "0.00",
        vBCST: money(meta.baseCalcStValue || 0),
        vST: money(meta.icmsStValue || 0),
        vFCPST: "0.00",
        vFCPSTRet: "0.00",
        vProd: money(meta.totalProductsValue || totalProducts || totalValue),
        vFrete: money(meta.freightValue || 0),
        vSeg: money(meta.insuranceValue || 0),
        vDesc: money((meta.discountValue || 0) + (clean(meta.funruralMode) !== "nao_desconta_nao_informa" ? Number(meta.funruralValue || 0) : 0)),
        vII: "0.00",
        vIPI: money(meta.ipiValue || totalIpi),
        vIPIDevol: "0.00",
        vPIS: money(Number(totalValue || 0) * 0.0165),
        vCOFINS: money(Number(totalValue || 0) * 0.076),
        vOutro: money(meta.otherValue || 0),
        vNF: money(meta.totalInvoiceValue || totalValue)
      }
    }
  };
}

export function buildNfePayload({ invoice, company, customer, product, products }) {
  const meta = typeof invoice.invoice_meta === "string" ? JSON.parse(invoice.invoice_meta || "{}") : invoice.invoice_meta || {};
  const totalValue = Number(invoice.total_value || meta.totalInvoiceValue || 0);
  const companyUf = clean(company.state).toUpperCase();
  const environmentCode = getEnvironmentCode(invoice.environment_mode || meta.environmentMode);
  const issueDate = clean(invoice.issue_date);
  const emitter = buildEmitter(company);
  const recipient = buildRecipient(customer);
  const transport = buildTransport(meta);
  const billing = buildBilling({ ...meta, issueDate, number: invoice.number }, totalValue);
  const itemBlock = buildItems({ ...meta, notes: invoice.notes }, product, products, totalValue, company);
  const codeUF = UF_CODE[companyUf];

  if (!codeUF) {
    throw new Error("Empresa: UF invalida para emissao NF-e.");
  }

  return {
    idLote: Number(invoice.id),
    indSinc: 1,
    NFe: {
      infNFe: {
        ide: {
          cUF: codeUF,
          cNF: String(invoice.access_key || invoice.generated_access_key).slice(35, 43),
          natOp: clean(meta.nature) || "Venda de mercadoria",
          mod: 55,
          serie: clean(invoice.series || "1"),
          nNF: Number(invoice.number),
          dhEmi: buildDateTime(issueDate, meta.issueTime),
          dhSaiEnt: buildDateTime(meta.dispatchDate || issueDate, meta.dispatchTime),
          tpNF: meta.nfType === "entrada" ? 0 : 1,
          idDest: 1,
          cMunFG: getCityCode(company, "Empresa"),
          tpImp: 1,
          tpEmis: 1,
          cDV: 0,
          tpAmb: environmentCode,
          finNFe: 1,
          indFinal: 1,
          indPres: asNumber(meta.buyerPresence, 1),
          procEmi: 0,
          verProc: "PortalFiscal 1.0"
        },
        emit: emitter,
        dest: recipient,
        ...itemBlock,
        transp: transport,
        ...(billing.cobr ? { cobr: billing.cobr } : {}),
        ...(billing.pag ? { pag: billing.pag } : {}),
        infAdic: {
          infCpl: buildAdditionalInfo(invoice.notes, meta)
        }
      }
    }
  };
}

export async function loadNfeWizard({ company, invoiceId, environmentMode }) {
  await ensureForgeDerCompatibility();
  await patchNfeWizardCertificateLoader();
  const { default: NFeWizard } = await import("nfewizard-io");
  const { certDir, xmlDir, logDir } = await prepareTempPaths(company.id, invoiceId);
  const certificatePath = await writeCertificate(company, certDir);
  let certificatePassword;

  try {
    certificatePassword = decryptSecretText(company.certificate_password);
  } catch {
    throw new Error("Nao foi possivel ler a senha do certificado da empresa. Revise o cadastro e informe a senha novamente.");
  }
  const wizard = new NFeWizard();

  if (!certificatePassword) {
    throw new Error("Nao foi possivel descriptografar a senha do certificado da empresa.");
  }

  await wizard.NFE_LoadEnvironment({
    config: {
      dfe: {
        ambiente: getEnvironmentCode(environmentMode),
        baixarXMLDistribuicao: false,
        armazenarXMLAutorizacao: true,
        pathXMLAutorizacao: xmlDir,
        armazenarXMLRetorno: true,
        pathXMLRetorno: logDir,
        armazenarXMLConsulta: true,
        pathXMLConsulta: logDir,
        armazenarXMLConsultaComTagSoap: false,
        armazenarRetornoEmJSON: true,
        pathRetornoEmJSON: logDir,
        pathCertificado: certificatePath,
        senhaCertificado: certificatePassword,
        UF: clean(company.state).toUpperCase(),
        CPFCNPJ: onlyDigits(company.cnpj)
      },
      nfe: {
        ambiente: getEnvironmentCode(environmentMode),
        versaoDF: "4.00"
      },
      lib: {
        connection: {
          timeout: 30000
        },
        log: {
          exibirLogNoConsole: false,
          armazenarLogs: true,
          pathLogs: logDir
        },
        useOpenSSL: false,
        useForSchemaValidation: "validateSchemaJsBased"
      }
    }
  });

  disableSchemaValidation(wizard);

  return wizard;
}

export function buildCancelPayload({ invoice, company, justification }) {
  const companyUf = clean(company.state).toUpperCase();
  const codeUF = UF_CODE[companyUf];

  if (!codeUF) {
    throw new Error("Empresa: UF invalida para cancelamento.");
  }

  if (!invoice.protocol_number) {
    throw new Error("A nota ainda nao possui protocolo de autorizacao para cancelar.");
  }

  return {
    idLote: Number(invoice.id),
    modelo: "55",
    evento: [
      {
        cOrgao: codeUF,
        tpAmb: getEnvironmentCode(invoice.environment_mode),
        CNPJ: onlyDigits(company.cnpj),
        chNFe: clean(invoice.access_key || invoice.generated_access_key),
        dhEvento: nowWithTimezone(),
        tpEvento: "110111",
        nSeqEvento: 1,
        verEvento: "1.00",
        detEvento: {
          descEvento: "Cancelamento",
          nProt: clean(invoice.protocol_number),
          xJust: clean(justification)
        }
      }
    ]
  };
}

export function buildStatusCode(company) {
  const codeUF = UF_CODE[clean(company.state).toUpperCase()];

  if (!codeUF) {
    throw new Error("Empresa: UF invalida para consulta.");
  }

  return codeUF;
}
