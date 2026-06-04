/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as XLSX from "xlsx";
import {
  Sparkles,
  UploadCloud,
  FileSpreadsheet,
  Edit2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Download,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Trash2,
  Info,
  HelpCircle,
  FileText,
  AlertCircle,
  UserCheck,
  Target,
  ChevronRight,
  Printer,
  ChevronDown,
  Eye,
  BookOpen,
  ExternalLink
} from "lucide-react";
import { CriteriaAnalysisItem, CustomerPersona, PainPointUSP, ProductInput, FinalMasterRow, ParsedSheet } from "./types";

export default function App() {
  // Wizard States
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Inputs
  const [productName, setProductName] = useState<string>("");
  const [productDescription, setProductDescription] = useState<string>("");
  const [productImage, setProductImage] = useState<string>("");
  const [imageLoading, setImageLoading] = useState<boolean>(false);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [dragActive, setDragActive] = useState<boolean>(false);

  // States for excel/csv tabular preview
  const [parsedSheets, setParsedSheets] = useState<ParsedSheet[]>([]);
  const [activeDescriptionTab, setActiveDescriptionTab] = useState<"text" | "table">("text");
  const [activeParsedSheetIndex, setActiveParsedSheetIndex] = useState<number>(0);
  const [tableSearchQuery, setTableSearchQuery] = useState<string>("");

  // Step 2: Personas (AI suggests 4) & 5 Criteria analysis
  const [personas, setPersonas] = useState<CustomerPersona[]>([]);
  const [criteriaAnalysis, setCriteriaAnalysis] = useState<CriteriaAnalysisItem[]>([]);
  const [activeCriteriaTab, setActiveCriteriaTab] = useState<string>("criteria-1");
  const [activeSegmentTab, setActiveSegmentTab] = useState<"analysis" | "personas">("analysis");
  // Step 3: Selected Persona & edited copy
  const [selectedPersonaIndex, setSelectedPersonaIndex] = useState<number | null>(null);
  const [editedPersona, setEditedPersona] = useState<CustomerPersona | null>(null);

  // Step 4: 10 pain point/USP solutions of product
  const [usps, setUsps] = useState<PainPointUSP[]>([]);
  const [selectedUsps, setSelectedUsps] = useState<string[]>([]);
  const [isEditingUspId, setIsEditingUspId] = useState<string | null>(null);

  // States for inline edit USP
  const [inlinePainPoint, setInlinePainPoint] = useState<string>("");
  const [inlineUsp, setInlineUsp] = useState<string>("");
  const [inlineDesc, setInlineDesc] = useState<string>("");

  // Export & Copy Success feedback
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [copyNotebookSuccess, setCopyNotebookSuccess] = useState<boolean>(false);

  // Step 5: Finalized report rows (8-column matrix from AI)
  const [reportRows, setReportRows] = useState<FinalMasterRow[]>([]);

  // Drag and drop event handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const parseTextToTable = (text: string, title: string = "Mô tả đã dán"): ParsedSheet => {
    const lines = text.split(/\r?\n/);
    const rows: string[][] = [];
    
    // Let's check if the text contains tabs (Excel/Sheet copy-paste)
    const hasTabs = text.includes("\t");
    
    if (hasTabs) {
      for (const l of lines) {
        if (!l.trim()) continue;
        const cells = l.split("\t").map(c => c.trim());
        rows.push(cells);
      }
    } else {
      // Single column or bullet points or key-value format
      // Let's check if it has colons (e.g., "Thương hiệu: Elmich")
      let colonCount = 0;
      const splitLines = lines.filter(l => l.trim().length > 0);
      for (const l of splitLines) {
        if (l.includes(":") && !l.startsWith("http") && !l.startsWith("-") && !l.startsWith("+")) {
          colonCount++;
        }
      }
      
      const isKeyValue = colonCount > splitLines.length * 0.25; // at least 25% are key-value
      
      if (isKeyValue) {
        rows.push(["Thuộc tính / Tiêu đề", "Giá trị mô tả"]);
        for (const l of splitLines) {
          const idx = l.indexOf(":");
          if (idx > 0 && !l.startsWith("http") && !l.startsWith("-") && !l.startsWith("+")) {
            const key = l.substring(0, idx).trim();
            const val = l.substring(idx + 1).trim();
            rows.push([key, val]);
          } else {
            rows.push(["Tính năng / Chi tiết", l.trim()]);
          }
        }
      } else {
        // Flat list of values, like in the second screenshot.
        // Let's present it as a clean list table with STT and Content columns.
        rows.push(["Dòng", "Chi tiết kỹ thuật"]);
        let stt = 1;
        for (const l of splitLines) {
          rows.push([`${stt++}`, l.trim()]);
        }
      }
    }
    
    return {
      name: title,
      rows: rows
    };
  };

  const handleExtractTableFromDescription = (customText?: string) => {
    const textToParse = customText !== undefined ? customText : productDescription;
    if (!textToParse.trim()) return;
    const newSheet = parseTextToTable(textToParse, "Bảng từ mô tả dán");
    
    // Filter out existing "Bảng từ mô tả dán" to avoid duplicates
    setParsedSheets((prev) => {
      const filtered = prev.filter((s) => s.name !== "Bảng từ mô tả dán");
      return [...filtered, newSheet];
    });

    // Automatically setting active sheet index to the newly created one
    setTimeout(() => {
      setParsedSheets((current) => {
        const idx = current.findIndex((s) => s.name === "Bảng từ mô tả dán");
        if (idx >= 0) {
          setActiveParsedSheetIndex(idx);
        }
        return current;
      });
    }, 80);

    // Also auto-detect name if empty
    handleDetectNameFromDescription(textToParse);
  };

  const handleDetectNameFromDescription = (customText?: string) => {
    const textToParse = customText !== undefined ? customText : productDescription;
    if (!textToParse.trim()) return;
    
    // Don't overwrite if product name is already a real one and not default placeholder
    const currentNameClean = productName ? productName.trim() : "";
    if (currentNameClean && currentNameClean !== "") {
      return;
    }

    const lines = textToParse.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0) {
      // First line is usually the product title! Especially in the provided Excel copy-paste image.
      const firstLine = lines[0];
      if (firstLine.length < 150 && !firstLine.startsWith("-") && !firstLine.startsWith("*") && !firstLine.startsWith("+")) {
        // Clean any weird prefixes
        let cleaned = firstLine
          .replace(/^[:"'\-\s]+/, "")
          .replace(/[:"'\-\s]+$/, "")
          .trim();
        if (cleaned) {
          const capitalized = cleaned
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          setProductName(capitalized);
        }
      }
    }
  };

  const handleDropText = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      handleProductFile(file);
    }
  };

  const runAutoDetection = (fileName: string, parsedText: string, sheets?: ParsedSheet[]) => {
    // If user has already entered a custom product name, don't overwrite
    const currentNameClean = productName ? productName.trim() : "";
    if (currentNameClean && currentNameClean !== "" && currentNameClean !== "N/A") {
      return;
    }

    let detected = "";

    const cleanName = (val: string) => {
      return val
        .replace(/[:"'\-\s]+$/, "")
        .replace(/^[:"'\-\s]+/, "")
        .trim();
    };

    // Heuristics 1: Parse string lines for keys like Tên sản phẩm, Sản phẩm, Tên dự án, vv...
    const lines = parsedText.split("\n");
    const labelRegex = /(?:Tên sản phẩm|Sản phẩm|Tên dự án|Product Name|Product|Dự án)\s*[:=]\s*([^\n\r]+)/i;
    for (const line of lines) {
      const match = line.match(labelRegex);
      if (match && match[1]) {
        detected = cleanName(match[1]);
        if (detected && detected.length > 1) {
          break;
        }
      }
    }

    // Heuristics 2: If Excel sheets exist, look at top cells
    if (!detected && sheets && sheets.length > 0) {
      for (const sheet of sheets) {
        const rows = sheet.rows.slice(0, 15);
        for (const row of rows) {
          for (let i = 0; i < row.length; i++) {
            const cellVal = row[i]?.trim();
            if (cellVal && /^(?:Tên sản phẩm|Sản phẩm|Tên dự án|Product Name|Product|Dự án)$/i.test(cellVal.replace(/[:=]$/, "").trim())) {
              if (row[i + 1]) {
                detected = cleanName(row[i + 1]);
                break;
              }
            }
          }
          if (detected) break;
        }
        if (detected) break;
      }
    }

    // Heuristics 3: Extract from file name and clean up meta tags
    if (!detected) {
      let nameNoExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
      nameNoExt = nameNoExt
        .replace(/^(?:Thong_tin_san_pham|thong_tin_san_pham|master_file|Master_File|data|report|tailieu|tai_lieu|thongtin|thong_tin|product|project|du_an|duan)[_\-\s]*/i, "")
        .replace(/[_\-]+/g, " ")
        .trim();
      
      // Convert CamelCase to spaced
      nameNoExt = nameNoExt.replace(/([a-z])([A-Z])/g, "$1 $2");
      if (nameNoExt && nameNoExt.length > 2) {
        detected = nameNoExt;
      }
    }

    if (detected) {
      // Title Case capitalizing
      const prettyName = detected
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      setProductName(prettyName);
    }
  };

  const handleProductFile = (file: File) => {
    // Skip hidden system files e.g. ._ or ~$ temp files
    if (file.name.startsWith("._") || file.name === ".DS_Store" || file.name.startsWith("~$")) {
      console.log("Bỏ qua file ẩn hệ thống:", file.name);
      return;
    }

    setUploadedFileName(file.name);
    const isExcel =
      file.name.endsWith(".xlsx") ||
      file.name.endsWith(".xls") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    const isCsv = file.name.endsWith(".csv");

    const reader = new FileReader();

    if (file.type.startsWith("image/")) {
      reader.onload = (e) => {
        if (e.target?.result) {
          setProductImage(e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    } else if (isExcel) {
      reader.onload = (e) => {
        if (e.target?.result) {
          try {
            const data = new Uint8Array(e.target.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: "array" });
            let text = `[Dữ liệu bóc tách từ tệp Excel: ${file.name}]\n`;
            
            const sheetsData: ParsedSheet[] = [];
            const sheetsProp = workbook.Workbook?.Sheets;

            workbook.SheetNames.forEach((sheetName, index) => {
              // Bỏ qua các sheet bị ẩn (Hidden check)
              const prop = sheetsProp ? (sheetsProp[index] || sheetsProp.find((s: any) => s.name === sheetName)) : null;
              const isHidden = prop && prop.Hidden !== undefined && prop.Hidden !== 0;
              if (isHidden) {
                console.log(`Bỏ qua trang tính ẩn: ${sheetName}`);
                return; // skip hidden sheet
              }

              const worksheet = workbook.Sheets[sheetName];
              
              // 1. Chuyển đổi thành định dạng text csv để lưu vào ô mô tả chính
              const csv = XLSX.utils.sheet_to_csv(worksheet);
              if (csv.trim()) {
                text += `\n--- Trang tính (Sheet): ${sheetName} ---\n${csv}\n`;
              }

              // 2. Chuyển đổi thành ma trận 2D để hiển thị bảng
              const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
              const stringRows: string[][] = jsonRows.map((row) =>
                row && Array.isArray(row)
                  ? row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
                  : []
              );

              if (stringRows.length > 0) {
                sheetsData.push({
                  name: sheetName,
                  rows: stringRows,
                });
              }
            });

            if (sheetsData.length > 0) {
              setParsedSheets((prev) => [...prev, ...sheetsData]);
              setActiveDescriptionTab("table");
              setActiveParsedSheetIndex(parsedSheets.length);
            }

            setProductDescription((prev) =>
              prev ? `${prev}\n\n${text}` : text
            );
            setTimeout(() => {
              runAutoDetection(file.name, text, sheetsData);
            }, 100);
          } catch (err: any) {
            setError(`Không thể phân tách dữ liệu Excel: ${err?.message || err}`);
          }
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (isCsv) {
      reader.onload = (e) => {
        if (e.target?.result) {
          try {
            const text = e.target.result as string;
            // Parse CSV with XLSX
            const workbook = XLSX.read(text, { type: "string" });
            const sheetName = file.name;
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];

            const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            const stringRows: string[][] = jsonRows.map((row) =>
              row && Array.isArray(row)
                ? row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
                : []
            );

            const newSheet: ParsedSheet = {
              name: sheetName,
              rows: stringRows,
            };

            if (stringRows.length > 0) {
              setParsedSheets((prev) => [...prev, newSheet]);
              setActiveDescriptionTab("table");
              setActiveParsedSheetIndex(parsedSheets.length);
            }

            setProductDescription((prev) =>
              prev ? `${prev}\n\n[Thông tin từ file CSV ${file.name}]:\n${text}` : text
            );
            setTimeout(() => {
              runAutoDetection(file.name, text, [newSheet]);
            }, 100);
          } catch (err: any) {
            setError(`Không thể phân tách dữ liệu CSV: ${err?.message || err}`);
          }
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = (e) => {
        if (e.target?.result) {
          const text = e.target.result as string;
          setProductDescription((prev) =>
            prev ? `${prev}\n\n[Thông tin từ file ${file.name}]:\n${text}` : text
          );
          setTimeout(() => {
            runAutoDetection(file.name, text);
          }, 100);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleProductFile(e.target.files[0]);
    }
  };

  // Image Upload handler
  const handleImageUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setProductImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper to safely execute backend calls and prevent "Unexpected token 'T'..." invalid JSON errors when Server returns HTML/404/500
  const safeFetchJson = async (url: string, options: RequestInit) => {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Giao diện nhận được phản hồi không hợp lệ từ máy chủ (Mã trạng thái: ${response.status}). Vui lòng đảm bảo ứng dụng đã cấu hình các biến môi trường (Ví dụ: GEMINI_API_KEY) đầy đủ.`);
      }
      if (!response.ok) {
        throw new Error(data?.error || `Máy chủ báo lỗi (${response.status}): ${response.statusText}`);
      }
      return data;
    } catch (err: any) {
      if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
        throw new Error("Lỗi kết nối từ trình duyệt đến máy chủ. Hãy kiểm tra kết nối mạng hoặc CORS.");
      }
      throw err;
    }
  };

  // Generate Image via backend
  const generateAIImage = async () => {
    if (!productName || !productDescription) {
      setError("Vui lòng nhập Tên sản phẩm và Mô tả tối thiểu để AI hình dung thiết kế.");
      return;
    }
    setError(null);
    setImageLoading(true);
    try {
      const data = await safeFetchJson("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName, productDescription }),
      });
      if (data && data.imageUrl) {
        setProductImage(data.imageUrl);
      } else {
        throw new Error("Không thể vẽ ảnh bằng AI.");
      }
    } catch (err: any) {
      setError(err?.message || "Lỗi khi kết nối vẽ ảnh.");
    } finally {
      setImageLoading(false);
    }
  };

  // Step 1 -> Step 2: Analyze Persona
  const startPersonaAnalysis = async () => {
    if (!productName.trim() || !productDescription.trim()) {
      setError("Vui lòng điền đầy đủ Tên và Mô tả thông tin sản phẩm.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const data = await safeFetchJson("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          productDescription,
          productBase64Image: productImage,
        }),
      });

      const generatedPersonas = (data.personas || []).map((p: any, idx: number) => ({
        ...p,
        id: `persona-${idx + 1}`,
      }));

      setPersonas(generatedPersonas);
      setCriteriaAnalysis(data.analysis || []);
      if (data.analysis && data.analysis.length > 0) {
        setActiveCriteriaTab(data.analysis[0].id);
      }
      setActiveSegmentTab("analysis"); // Đặt mặc định hiển thị tab Khảo Sát của AI lên trước
      setCurrentStep(2);
    } catch (err: any) {
      setError(err?.message || "Đã xảy ra lỗi hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 -> Step 3: Choose persona & open editor
  const handleSelectPersona = (index: number) => {
    setSelectedPersonaIndex(index);
    setEditedPersona({ ...personas[index] });
    setCurrentStep(3);
  };

  // Step 3: Edit Selected Persona inline values
  const handleSavePersonaEdits = () => {
    if (!editedPersona) return;
    // Save back to updated persona list
    const updatedPersonas = [...personas];
    if (selectedPersonaIndex !== null) {
      updatedPersonas[selectedPersonaIndex] = { ...editedPersona };
      setPersonas(updatedPersonas);
    }
    // Proceed to Step 4: AI analyses pain-points & USPs
    generatePainPointUSPs();
  };

  // Step 3 -> Step 4: Generate 10 pain points and USPs
  const generatePainPointUSPs = async () => {
    if (!editedPersona) return;
    setError(null);
    setLoading(true);

    try {
      const data = await safeFetchJson("/api/usps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          productDescription,
          selectedPersona: editedPersona,
        }),
      });

      const formattedUsps = (data.usps || []).map((item: any, idx: number) => ({
        ...item,
        id: `usp-${idx + 1}`,
      }));

      setUsps(formattedUsps);
      setSelectedUsps([]); // clean previous choices
      setCurrentStep(4);
    } catch (err: any) {
      setError(err?.message || "Đã xảy ra lỗi khi tạo ra USP.");
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Checkbox USP toggling
  const toggleSelectUsp = (id: string) => {
    if (selectedUsps.includes(id)) {
      setSelectedUsps((prev) => prev.filter((item) => item !== id));
    } else {
      setSelectedUsps((prev) => [...prev, id]);
    }
  };

  // Step 4: Start Inline Edit Mode for one USP
  const startInlineEditUsp = (item: PainPointUSP) => {
    setIsEditingUspId(item.id);
    setInlinePainPoint(item.painPoint);
    setInlineUsp(item.usp);
    setInlineDesc(item.description);
  };

  const saveInlineEditUsp = (id: string) => {
    setUsps((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              painPoint: inlinePainPoint,
              usp: inlineUsp,
              description: inlineDesc,
            }
          : item
      )
    );
    setIsEditingUspId(null);
  };

  // Step 4 -> Master: Proceed if EXACTLY 5 USPs are selected
  const finalizeMasterFile = async () => {
    if (selectedUsps.length !== 5) return;
    setError(null);
    setLoading(true);

    try {
      const data = await safeFetchJson("/api/finalize-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          productDescription,
          selectedPersona: editedPersona || (selectedPersonaIndex !== null ? personas[selectedPersonaIndex] : null),
          selectedUsps: getSelectedUspObjects(),
        }),
      });

      setReportRows(data.reportRows || []);
      setCurrentStep(5);
    } catch (err: any) {
      setError(err?.message || "Đã xảy ra lỗi khi tạo File Master và bảng 8 cột.");
    } finally {
      setLoading(false);
    }
  };

  // Reset to original Step 1
  const handleReset = () => {
    setCurrentStep(1);
    setProductName("");
    setProductDescription("");
    setProductImage("");
    setUploadedFileName("");
    setPersonas([]);
    setSelectedPersonaIndex(null);
    setEditedPersona(null);
    setUsps([]);
    setSelectedUsps([]);
    setReportRows([]);
    setError(null);
  };

  // Export utilities for Step 5
  const getSelectedUspObjects = () => {
    return usps.filter((u) => selectedUsps.includes(u.id));
  };

  const handleUpdateRowCell = (index: number, field: keyof FinalMasterRow, val: string) => {
    setReportRows((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: field === "stt" ? Number(val) : val,
      };
      return updated;
    });
  };

  const generateMarkdownReport = () => {
    const chosenPersona = editedPersona || (selectedPersonaIndex !== null ? personas[selectedPersonaIndex] : null);

    let markdown = `# FILE MASTER SẢN PHẨM & USP ĐỊNH VỊ THƯƠNG HIỆU\n`;
    markdown += `--------------------------------------------------------\n`;
    markdown += `## 1. THÔNG TIN SẢN PHẨM\n`;
    markdown += `- **Tên sản phẩm**: ${productName}\n`;
    markdown += `- **Mô tả cốt lõi**: ${productDescription}\n\n`;

    markdown += `## 2. CHÂN DUNG KHÁCH HÀNG MỤC TIÊU\n`;
    markdown += `- **Tên nhóm**: ${chosenPersona?.name || "N/A"}\n`;
    markdown += `- **Nhân khẩu học & Hành vi**: ${chosenPersona?.demographics || "N/A"}\n`;
    markdown += `- **Nỗi bức xúc cốt lõi**: ${chosenPersona?.painPoints || "N/A"}\n`;
    markdown += `- **Lợi ích mong muốn**: ${chosenPersona?.benefits || "N/A"}\n`;
    markdown += `- **Tâm niệm**: "${chosenPersona?.summary || "N/A"}"\n\n`;

    markdown += `## 3. BẢNG CHIẾN LƯỢC ĐỊNH VỊ MARKETING (8 CỘT CHUẨN)\n\n`;
    markdown += `| STT | Bước (Step) | Mục Tiêu Tâm Lý | Nỗi Đau & Mong Muốn | Các bước | USP (Lợi ích -> Thông số) | Headline - Subheadline | Minh họa hình ảnh (Visual Key) |\n`;
    markdown += `|---|---|---|---|---|---|---|---|\n`;
    
    reportRows.forEach((row) => {
      markdown += `| ${row.stt} | ${row.step} | ${row.psychologicalGoal} | ${row.painPointAndDesire} | ${row.stepsDetail} | ${row.uspDetail} | ${row.headlineSubheadline} | ${row.visualKey} |\n`;
    });

    markdown += `\n--------------------------------------------------------\n`;
    markdown += `*File báo cáo được tạo tự động bởi Trình Tạo File Master USP Sản Phẩm AI*`;
    return markdown;
  };

  const handleCopyToClipboard = () => {
    const report = generateMarkdownReport();
    navigator.clipboard.writeText(report);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  const handleDownloadCSV = () => {
    const chosenPersona = editedPersona || (selectedPersonaIndex !== null ? personas[selectedPersonaIndex] : null);

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: THUONG HEU & USP CAP (General Overview)
    const sheet1Data: any[][] = [
      ["BẢN PHÊ DUYỆT FILE MASTER ĐỊNH VỊ THƯƠNG HIỆU & HỆ THỐNG USP CỐT LÕI (AI POWER) "],
      [`Xuất bản ngày: ${new Date().toLocaleDateString("vi-VN")} lúc ${new Date().toLocaleTimeString("vi-VN")}`],
      [],
      ["I. THÔNG TIN SẢN PHẨM & DỰ ÁN"],
      ["Tên sản phẩm:", productName],
      ["Mô tả kỹ thuật & Giải pháp cốt lõi:", productDescription],
      [],
      ["II. TIÊU ĐIỂM CHÂN DUNG KHÁCH HÀNG MỤC TIÊU (SELECTED PERSONA)"],
      ["Danh xưng nhóm khách hàng lý tưởng:", chosenPersona?.name || "N/A"],
      ["Giải mã Nhân khẩu học & Hành vi:", chosenPersona?.demographics || "N/A"],
      ["Nỗi bức xúc cốt lõi / Nỗi đau sâu thẳm:", chosenPersona?.painPoints || "N/A"],
      ["Xúc cảm, lợi ích mong muốn vượt bực:", chosenPersona?.benefits || "N/A"],
      ["Tâm niệm thầm kín tự quy định:", chosenPersona?.summary || "N/A"],
      [],
      ["III. 5 CẶP GIẢI PHÁP & USP ĐÃ LỰA CHỌN TRONG CHIẾN DỊCH"],
      ["STT", "Nỗi lo lắng / Nỗi đau khách hàng", "Định vị / Giải pháp USP tương đương", "Chi tiết chuyển đổi / Kịch bản thông điệp"]
    ];

    const chosenUsps = getSelectedUspObjects();
    chosenUsps.forEach((item, idx) => {
      sheet1Data.push([
        (idx + 1).toString(),
        item.painPoint || "",
        item.usp || "",
        item.description || ""
      ]);
    });

    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    ws1["!cols"] = [
      { wch: 30 }, // Cột tiêu đề danh mục
      { wch: 45 }, // Cột nội dung chính 1
      { wch: 45 }, // Cột nội dung chính 2
      { wch: 55 }  // Cột nội dung chính 3
    ];

    // Sheet 2: MA TRAN MARKETING 8 COT (8-Column Matrix Table)
    const sheet2Data: any[][] = [
      ["ĐẠI MA TRẬN MARKETING 8 BƯỚC CHI TIẾT - PHÂN TÍCH TÂM LÝ & BÀN GIAO TRUYỀN THÔNG"],
      [`Chiến dịch sản phẩm: ${productName}`],
      [],
      [
        "STT",
        "Bước (Step)",
        "Mục Tiêu Tâm Lý Cốt Lõi",
        "Nỗi Đau & Kỳ Vọng Chi Phối",
        "Các Bước Triển Khai Thực Tế (Kịch Bản)",
        "USP Vượt Trội (Lợi ích khách hàng -> Thông Số Kỹ Thuật)",
        "Tiêu Đề & Tiêu Đề Phụ Truyền Thông (Headline/Subheadline)",
        "Ý Tưởng Hình Ảnh & Bối Cảnh Hiển Thị (Visual Key)"
      ]
    ];

    reportRows.forEach((row) => {
      sheet2Data.push([
        row.stt ? row.stt.toString() : "",
        row.step || "",
        row.psychologicalGoal || "",
        row.painPointAndDesire || "",
        row.stepsDetail || "",
        row.uspDetail || "",
        row.headlineSubheadline || "",
        row.visualKey || ""
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
    ws2["!cols"] = [
      { wch: 6 },   // STT
      { wch: 22 },  // Bước (Step)
      { wch: 30 },  // Mục Tiêu Tâm Lý
      { wch: 40 },  // Nỗi Đau & Mong Muốn
      { wch: 40 },  // Các bước
      { wch: 45 },  // USP
      { wch: 45 },  // Headline
      { wch: 40 }   // Visual Key
    ];

    // Append sheets to workbook
    XLSX.utils.book_append_sheet(wb, ws1, "1. Tong quan & USP");
    XLSX.utils.book_append_sheet(wb, ws2, "2. Ma tran 8 Cot Chien dich");

    // Write file directly with native .xlsx suffix
    const fileBaseName = productName.replace(/[^a-zA-Z0-9]/g, "_") || "san_pham";
    XLSX.writeFile(wb, `Master_File_USP_Strategic_Report_${fileBaseName}.xlsx`);
  };

  const generateNotebookLMPrompt = () => {
    const chosenPersona = editedPersona || (selectedPersonaIndex !== null ? personas[selectedPersonaIndex] : null);

    let doc = `# TÀI LIỆU NGUỒN ĐỊNH VỊ THƯƠNG HIỆU & HỆ THỐNG USP SẢN PHẨM PHÂN TÍCH BỞI AI\n`;
    doc += `========================================================\n\n`;
    
    doc += `## I. THÔNG TIN SẢN PHẨM KHAI BÁO CỐT LÕI\n`;
    doc += `- Tên sản phẩm: ${productName}\n`;
    doc += `- Mô tả chi tiết và tính năng: ${productDescription}\n\n`;

    doc += `## II. CHÂN DUNG KHÁCH HÀNG LÝ TƯỞNG (PERSONA MỤC TIÊU)\n`;
    doc += `- Nhóm khách hàng: ${chosenPersona?.name || "N/A"}\n`;
    doc += `- Đặc điểm Nhân khẩu học & Hành vi: ${chosenPersona?.demographics || "N/A"}\n`;
    doc += `- Nỗi bức xúc, vấn đề hoặc nỗi đau lớn nhất: ${chosenPersona?.painPoints || "N/A"}\n`;
    doc += `- Lợi ích mong muốn & Giá trị cốt lõi giải quyết: ${chosenPersona?.benefits || "N/A"}\n`;
    doc += `- Phương châm hành động đặc thù: "${chosenPersona?.summary || "N/A"}"\n\n`;

    doc += `## III. BẢNG CHIẾN LƯỢC ĐỊNH VỊ 8 BƯỚC MARKETING CHI TIẾT (MASTER USP BOARD)\n`;
    doc += `Dưới đây là bảng phân tích kịch bản tương tác và định hướng nội dung qua 8 bước tâm lý từ khi khách hàng chưa biết sản phẩm đến hành động trung thành:\n\n`;

    reportRows.forEach((row) => {
      doc += `### BƯỚC ${row.stt}: ${row.step}\n`;
      doc += `- Mục tiêu tâm lý: ${row.psychologicalGoal}\n`;
      doc += `- Nỗi đau & Mong muốn chạm tới: ${row.painPointAndDesire}\n`;
      doc += `- Các bước hành động cụ thể: ${row.stepsDetail}\n`;
      doc += `- USP và giải pháp giá trị cốt lõi: ${row.uspDetail}\n`;
      doc += `- Tiêu đề truyền thông (Headline - Subheadline): ${row.headlineSubheadline}\n`;
      doc += `- Định hướng hình ảnh (Visual Key): ${row.visualKey}\n`;
      doc += `\n`;
    });

    doc += `========================================================\n`;
    doc += `HƯỚNG DẪN DÀNH CHO BẠN KHI DÙNG VỚI NOTEBOOKLM:\n`;
    doc += `Sử dụng tài liệu này làm Source (Nguồn) chính trong NotebookLM để:\n`;
    doc += `1. Yêu cầu tạo kịch bản video ngắn (TikTok, Reels, Shorts) theo từng Bước tâm lý ở trên.\n`;
    doc += `2. Soạn thảo chuỗi bài viết email nuôi dưỡng (Email Nurturing) cho tệp khách hàng mục tiêu.\n`;
    doc += `3. Tạo bản tóm tắt nội dung âm thanh (Audio Overview Podcast) giới thiệu dự án định vị.\n`;
    doc += `4. Hỏi bất kỳ câu hỏi nào để đào sâu chiến lược bán lẻ hoặc xây dựng thương hiệu dựa trên tài liệu này.\n`;
    return doc;
  };

  const handleCopyNotebookLM = () => {
    const doc = generateNotebookLMPrompt();
    navigator.clipboard.writeText(doc);
    setCopyNotebookSuccess(true);
    setTimeout(() => setCopyNotebookSuccess(false), 2500);
  };

  const handleDownloadNotebookLM = () => {
    const doc = generateNotebookLMPrompt();
    const blob = new Blob([doc], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `NotebookLM_Source_${productName.replace(/[^a-zA-Z0-9]/g, "_") || "san_pham"}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col selection:bg-blue-600 selection:text-white overflow-x-hidden">
      <h1 className="sr-only">Trình Tạo File Master USP Sản Phẩm</h1>

      {/* Header Navigation */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 flex-shrink-0 sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm shadow-blue-500/25">
            <FileSpreadsheet className="w-4 h-4" id="logo-icon" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight text-slate-800">
              Master USP Builder <span className="text-blue-600 font-semibold text-xs sm:text-sm">v2.0</span>
            </h2>
            <p className="text-[10px] sm:text-xs text-slate-500 hidden md:block leading-none">
              Thiết lập bản cứng 5 bộ USP sát sườn chuẩn định vị thương hiệu
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {currentStep > 1 && (
            <button
              id="btn-reset"
              onClick={handleReset}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
          )}

          <div className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 font-bold text-xs shadow-xs">
            U
          </div>
        </div>
      </header>

      {/* Main Workspace Frame container */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        
        {/* Left Sidebar Layout Navigation (Desktop) */}
        <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col p-4 sm:p-5 flex-shrink-0">
          <div className="mb-4 lg:mb-8">
            <h3 className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 block">
              QUY TRÌNH XÂY DỰNG
            </h3>
            
            {/* Steps Nav Links styling like the reference design */}
            <nav className="space-y-1 sm:space-y-1.5">
              <button
                disabled={currentStep < 1}
                onClick={() => currentStep > 1 && setCurrentStep(1)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === 1
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-600 font-bold shadow-xs"
                    : "text-slate-400 border-l-2 border-transparent hover:text-slate-600"
                }`}
              >
                <span className={`w-5.5 h-5.5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep >= 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}>01</span>
                <span className="text-xs sm:text-sm font-medium">Thông tin cơ bản</span>
              </button>

              <button
                disabled={personas.length === 0}
                onClick={() => personas.length > 0 && setCurrentStep(2)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === 2
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-600 font-bold shadow-xs"
                    : "text-slate-400 border-l-2 border-transparent hover:text-slate-600"
                }`}
              >
                <span className={`w-5.5 h-5.5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep >= 2 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}>02</span>
                <span className="text-xs sm:text-sm font-medium">Phân tích chân dung</span>
              </button>

              <button
                disabled={!editedPersona}
                onClick={() => editedPersona && setCurrentStep(3)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === 3
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-600 font-bold shadow-xs"
                    : "text-slate-400 border-l-2 border-transparent hover:text-slate-600"
                }`}
              >
                <span className={`w-5.5 h-5.5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep >= 3 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}>03</span>
                <span className="text-xs sm:text-sm font-medium">Chọn & Sửa kỹ</span>
              </button>

              <button
                disabled={usps.length === 0}
                onClick={() => usps.length > 0 && setCurrentStep(4)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === 4
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-600 font-bold shadow-xs"
                    : "text-slate-400 border-l-2 border-transparent hover:text-slate-600"
                }`}
              >
                <span className={`w-5.5 h-5.5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep >= 4 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}>04</span>
                <span className="text-xs sm:text-sm font-semibold">Thiết lập 5 USP</span>
              </button>

              <button
                disabled={selectedUsps.length !== 5}
                onClick={() => selectedUsps.length === 5 && setCurrentStep(5)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  currentStep === 5
                    ? "bg-blue-50 text-blue-700 border-l-2 border-blue-600 font-bold shadow-xs"
                    : "text-slate-400 border-l-2 border-transparent hover:text-slate-600"
                }`}
              >
                <span className={`w-5.5 h-5.5 flex items-center justify-center rounded-full text-[10px] font-bold ${
                  currentStep >= 5 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                }`}>05</span>
                <span className="text-xs sm:text-sm font-medium">Phê duyệt & Lưu</span>
              </button>
            </nav>
          </div>

          {/* Current Project and progress percent dashboard matching HTML mock */}
          <div className="mt-auto p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl transition duration-150">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Dự án hiện hành:</p>
            <h4 className="text-xs sm:text-sm font-black text-slate-800 truncate">
              {productName ? productName : "Chưa xác lập thông tin..."}
            </h4>
            <div className="mt-3 w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{
                  width:
                    currentStep === 1
                      ? "20%"
                      : currentStep === 2
                      ? "40%"
                      : currentStep === 3
                      ? "60%"
                      : currentStep === 4
                      ? "80%"
                      : "100%",
                }}
              ></div>
            </div>
            <p className="text-[9px] text-right mt-1 text-slate-400 font-black tracking-widest uppercase">
              HOÀN THÀNH {currentStep * 20}%
            </p>
          </div>
        </aside>

        {/* Dynamic content Workspace */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {loading && (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md px-4 text-center">
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full space-y-6 flex flex-col items-center">
                <div className="relative flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin"></div>
                  <Sparkles className="w-6 h-6 text-amber-500 absolute animate-pulse" />
                </div>
                <div className="space-y-2 text-center">
                  <h4 className="font-extrabold text-slate-800 text-base">Hệ thống AI Đang Làm Việc</h4>
                  <p className="text-slate-600 text-xs sm:text-sm font-medium leading-relaxed">
                    {currentStep === 1 
                      ? "AI đang bóc tách thuộc tính sản phẩm và phác họa 4 chân dung tiềm năng có tỉ lệ chuyển đổi thành công nhất..." 
                      : currentStep === 3 
                      ? "AI đang thiết kế 10 kịch bản định vị gồm hành vi, nỗi đau và bộ USP đặc hữu sắc sảo..." 
                      : "Gemini AI đang tổng hợp 5 cặp USP chiến lược và điền các phân loại tâm lý, headline, ý tưởng visual vào file bảng Master 8 cột..."}
                  </p>
                </div>
                <div className="text-[10px] text-slate-400 font-mono uppercase tracking-widest animate-pulse">
                  Xin vui lòng đợi trong giây lát • Khoảng 10-15 giây
                </div>
              </div>
            </div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-3 text-rose-800 text-sm shadow-xs"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-extrabold text-rose-900">Đã xảy ra lỗi tương tác dữ liệu</p>
                <p className="text-rose-700 leading-relaxed font-sans">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-black uppercase text-rose-500 hover:text-rose-700 font-sans cursor-pointer shrink-0"
              >
                Đóng
              </button>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
                className="max-w-4xl mx-auto"
              >
                {/* Main Core Form Inputs block */}
                <div className="bg-white p-5 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                  <div>
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest block mb-1">
                      Thiết lập ban đầu
                    </span>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight font-sans">
                      Nhập Thông Tin Sản Phẩm & Ý Tưởng
                    </h2>
                    <p className="text-slate-500 text-xs sm:text-sm font-medium">
                      Khai báo chi tiết để AI phân loại tệp khách hàng tiềm năng cốt lõi.
                    </p>
                  </div>

                  <div className="space-y-4">
                  {/* Integrated Drag and drop styled like reference (NOW PLACED TRULY FIRST ON TOP!) */}
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDropText}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                      dragActive
                        ? "bg-blue-50/50 border-blue-600"
                        : "bg-slate-50 hover:bg-slate-100/40 border-slate-200"
                    }`}
                  >
                    <input
                      type="file"
                      id="file-txt-upload"
                      accept=".txt,.md,.json,.csv,.xlsx,.xls"
                      onChange={handleFileInputChange}
                      className="hidden"
                    />
                    <label htmlFor="file-txt-upload" className="cursor-pointer space-y-2 block">
                      <div className="mx-auto w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shadow-xxs">
                        <UploadCloud className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="text-xs sm:text-sm text-slate-700">
                        <span className="font-bold text-blue-600 hover:underline">Nhấp chọn tài liệu</span> hoặc kéo thả file dữ liệu vào đây (.xlsx, .xls, .csv, .txt)
                      </div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                        Hỗ trợ Excel, CSV và tệp văn bản thô
                      </p>
                    </label>

                    {uploadedFileName && (
                      <div className="mt-3 inline-flex items-center space-x-1.5 bg-blue-50 border border-blue-200 text-blue-800 px-3.5 py-1 rounded-full text-xs font-semibold">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        <span className="font-semibold truncate max-w-xs">{uploadedFileName}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label id="lbl-prod-name" className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1.5 font-sans">
                      Tên sản phẩm thiết bị / Dịch vụ *
                    </label>
                    <input
                      id="input-prod-name"
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Ví dụ: Máy lọc không khí PureFlow 3000, Khóa học AI Copywriting đỉnh cao..."
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-sm text-slate-800 placeholder-slate-400 font-medium transition duration-150"
                    />
                  </div>

                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-1 border-b border-slate-100 font-sans">
                      <label id="lbl-prod-desc" className="block text-xs font-black uppercase tracking-wider text-slate-700">
                        Mô tả kỹ thuật & Giải pháp sản phẩm mang lại *
                      </label>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1">
                        <textarea
                          id="input-prod-desc"
                          rows={6}
                          value={productDescription}
                          onChange={(e) => {
                            const val = e.target.value;
                            setProductDescription(val);
                            
                            // Auto detect name if empty
                            if (val.trim()) {
                              handleDetectNameFromDescription(val);
                              
                              // If it contains multiple tabs, it is likely copied from Excel. Auto parse it for flawless UX!
                              if (val.includes("\t") && val.trim().length > 15) {
                                const newSheet = parseTextToTable(val, "Bảng từ mô tả dán");
                                setParsedSheets((prev) => {
                                  const filtered = prev.filter((s) => s.name !== "Bảng từ mô tả dán");
                                  return [...filtered, newSheet];
                                });
                              }
                            }
                          }}
                          placeholder="Mô tả kỹ lưỡng công dụng lý tính, hoặc dán trực tiếp dòng dữ liệu copy từ Excel/bảng biểu như trong ảnh của bạn. AI sẽ biến tất cả thành bảng dữ liệu chuyên nghiệp..."
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-sm text-slate-800 placeholder-slate-400 font-sans leading-relaxed transition duration-150"
                        />
                        
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 font-sans select-none pb-2">
                          <div className="text-[10px] text-slate-400 font-medium font-mono whitespace-nowrap">
                            {productDescription.length} ký tự
                          </div>
                          
                          {productDescription.trim().length > 5 && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleExtractTableFromDescription()}
                                className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-200 transition-all cursor-pointer shadow-xxs active:scale-95"
                                title="Chuyển đổi thông tin dán thô, danh sách dòng, hoặc bảng biểu thành Bảng dữ liệu chuẩn"
                              >
                                <Sparkles className="w-3.5 h-3.5 animate-pulse text-blue-600" />
                                <span>⚡ Trích xuất thành bảng dữ liệu</span>
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => {
                                  setProductName("");
                                  setTimeout(() => handleDetectNameFromDescription(), 50);
                                }}
                                className="inline-flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 transition-all cursor-pointer shadow-xxs active:scale-95"
                                title="Tự động trích lọc và định danh Tên sản phẩm từ mô tả"
                              >
                                <FileText className="w-3.5 h-3.5 text-slate-500" />
                                <span>🔍 Tìm Tên sản phẩm</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {parsedSheets.length > 0 && (
                        <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/50">
                          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-500 animate-pulse" />
                            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 font-sans">
                              Danh sách bảng dữ liệu đã tải lên ({parsedSheets.length})
                            </h4>
                          </div>

                          <div className="space-y-3">
                            {/* Tab buttons for multiple parsed sheets */}
                            <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-250">
                              {parsedSheets.map((sheet, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setActiveParsedSheetIndex(idx)}
                                  className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                                    activeParsedSheetIndex === idx
                                      ? "bg-slate-900 text-white"
                                      : "bg-white text-slate-600 hover:bg-slate-200/60 border border-slate-200"
                                  }`}
                                >
                                  📁 {sheet.name}
                                </button>
                              ))}
                            </div>

                            {/* Search cell values tool box */}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="🔍 Lọc nhanh dòng dữ liệu trong sheet..."
                                value={tableSearchQuery}
                                onChange={(e) => setTableSearchQuery(e.target.value)}
                                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                              />
                              {tableSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setTableSearchQuery("")}
                                  className="px-2.5 bg-slate-200 text-slate-600 hover:bg-slate-350 text-xs font-bold rounded-lg transition cursor-pointer font-sans"
                                >
                                  Xóa
                                </button>
                              )}
                            </div>

                            {/* The Spreadsheet Table Component */}
                            {parsedSheets[activeParsedSheetIndex] && (
                              <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white max-h-[250px] overflow-y-auto custom-scrollbar shadow-xxs">
                                <table className="min-w-full divide-y divide-slate-200 text-left border-collapse table-auto select-none font-sans">
                                  <tbody className="divide-y divide-slate-200 divide-x divide-slate-100">
                                    {parsedSheets[activeParsedSheetIndex].rows
                                      .filter((row) => {
                                        if (!tableSearchQuery.trim()) return true;
                                        return row.some((cell) =>
                                          cell.toLowerCase().includes(tableSearchQuery.toLowerCase())
                                        );
                                      })
                                      .map((row, rIdx) => (
                                        <tr
                                          key={rIdx}
                                          className={`${
                                            rIdx === 0
                                              ? "bg-slate-50 font-black text-slate-700 sticky top-0 uppercase text-[9px] tracking-wider"
                                              : "text-slate-600 hover:bg-slate-100/30 text-[11px] even:bg-slate-50/20"
                                          }`}
                                        >
                                          {row.map((cell, cIdx) => (
                                            <td
                                              key={cIdx}
                                              className="px-3 py-1.5 border-r border-slate-100 truncate max-w-[180px] font-medium leading-normal animate-fade-in"
                                              title={cell}
                                            >
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            
                            <p className="text-[10px] text-slate-400 italic font-sans">
                              * Đang hiển thị sheet: <strong>{parsedSheets[activeParsedSheetIndex]?.name}</strong>
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Image Demo Illustration Module for uploading white bg image */}
                  <div className="bg-slate-50 p-4 sm:p-5 rounded-xl border border-slate-200 space-y-3.5">
                    <div className="space-y-1">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700 font-sans">
                        Ảnh chụp sản phẩm nền trắng (Tùy chọn)
                      </label>
                      <p className="text-slate-500 text-[11px] leading-normal font-medium font-sans">
                        Tải lên ảnh chụp thực tế của sản phẩm trên nền trắng để thiết kế bối cảnh hiển thị trực quan và tối ưu định vị thương hiệu.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      <div className="w-28 h-28 shrink-0 bg-white border border-slate-200 rounded-xl flex items-center justify-center relative overflow-hidden group shadow-xxs">
                        {productImage ? (
                          <>
                            <img
                              src={productImage}
                              alt="Xem trước sản phẩm"
                              referrePolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <button
                              id="btn-remove-img"
                              type="button"
                              onClick={() => setProductImage("")}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition duration-200 cursor-pointer font-sans"
                            >
                              Gỡ bỏ ảnh
                            </button>
                          </>
                        ) : (
                          <div className="text-center p-3 text-slate-400 flex flex-col items-center justify-center">
                            <PhotoIconPlaceholder />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-350 font-sans">Không ảnh</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 w-full space-y-2">
                        <input
                          type="file"
                          id="image-file-upload"
                          accept="image/*"
                          onChange={handleImageUploadChange}
                          className="hidden"
                        />
                        <label
                          htmlFor="image-file-upload"
                          className="w-full py-3 px-4 border border-slate-250 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xxs transition duration-150 font-sans"
                        >
                          <UploadCloud className="w-4 h-4 text-blue-600" />
                          <span>Tải lên ảnh sản phẩm từ thiết bị</span>
                        </label>
                        <p className="text-[10px] text-slate-400 font-medium font-sans">
                          Hỗ trợ định dạng: PNG, JPG, JPEG, WEBP. Nên sử dụng ảnh sản phẩm có nền trắng sạch để làm cơ sở thiết kế.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                    <button
                      id="btn-submit-step1"
                      type="button"
                      onClick={startPersonaAnalysis}
                      disabled={loading || !productName.trim() || !productDescription.trim()}
                      className={`w-full py-3.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition duration-200 ${
                        loading || !productName.trim() || !productDescription.trim()
                          ? "bg-blue-300 text-blue-50 cursor-not-allowed"
                          : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/25 cursor-pointer"
                      }`}
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-white" />
                          <span>Gemini đang khai mở 4 tệp chân dung khách hàng đặc hiệu (10-15 giây)...</span>
                        </>
                      ) : (
                        <>
                          <span>Khởi chạy Phase 2: Phân Tích Chân Dung Khách Hàng</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 2 Page Content layout */}
            {currentStep === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* Header widget */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 uppercase tracking-widest">
                      <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                      <span>Đột phá tư duy định vị với Gemini AI</span>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 tracking-tight">
                      Bước 2: Phân Tích Thấu Đáo Khách Hàng & Chân Dung Đích
                    </h3>
                    <p className="text-slate-500 text-xs sm:text-sm">
                      Duyệt qua <strong>Bản Khảo Sát 5 Tiêu Chí Tiền Đề</strong> mà AI thu thập, sau đó chọn và hiệu chỉnh 1 trong <strong>4 Chân Dung Độc Lập</strong> để viết USP.
                    </p>
                  </div>

                  <button
                    id="btn-back-to-step1"
                    onClick={() => setCurrentStep(1)}
                    className="px-4 py-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition duration-150"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
                    <span>Làm lại mô tả từ đầu</span>
                  </button>
                </div>

                {/* Main Tabs Selection */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="flex border-b border-slate-200 bg-slate-50/50 p-1">
                    <button
                      onClick={() => setActiveSegmentTab("analysis")}
                      className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                        activeSegmentTab === "analysis"
                          ? "bg-white text-blue-700 shadow-xs border border-slate-200"
                          : "text-slate-500 hover:text-slate-800 hover:bg-white/40"
                      }`}
                    >
                      <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                      <span>📊 Khảo Sát 5 Tiêu Chí & Các Câu Hỏi Trả Lời (Tiền Đề)</span>
                    </button>
                    <button
                      onClick={() => setActiveSegmentTab("personas")}
                      className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                        activeSegmentTab === "personas"
                          ? "bg-white text-blue-700 shadow-xs border border-slate-200"
                          : "text-slate-500 hover:text-slate-800 hover:bg-white/40"
                      }`}
                    >
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span>👥 Gợi Ý 4 Chân Dung Khách Hàng Lý Tưởng</span>
                    </button>
                  </div>

                  {activeSegmentTab === "analysis" && (
                    <div className="p-4 sm:p-6">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Left sidebar: 5 Criteria Tabs */}
                        <div className="lg:col-span-4 space-y-2">
                          <span className="block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest pl-2 mb-3">
                            Danh Sách Các Tiêu Chí Do AI Bóc Tách
                          </span>
                          {criteriaAnalysis.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setActiveCriteriaTab(item.id)}
                              className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-1 ${
                                activeCriteriaTab === item.id
                                  ? "border-blue-500 bg-blue-50/40 shadow-xs ring-1 ring-blue-500/20"
                                  : "border-slate-100 hover:border-slate-300 bg-white"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${activeCriteriaTab === item.id ? 'bg-blue-600' : 'bg-slate-300'}`} />
                                <span className={`text-xs font-bold ${activeCriteriaTab === item.id ? "text-blue-900" : "text-slate-700"}`}>
                                  {item.title}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400 font-medium pl-4.5 block truncate">
                                {item.detail}
                              </span>
                            </button>
                          ))}

                          <div className="mt-6 pt-4 border-t border-slate-100 pl-2">
                            <button
                              onClick={() => {
                                setActiveSegmentTab("personas");
                                window.scrollTo({ top: 300, behavior: 'smooth' });
                              }}
                              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition duration-150 cursor-pointer"
                            >
                              <span>Bước Tiếp: Xem 4 Chân Dung Đề Xuất</span>
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Right Content: Q&A answers list of active criteria */}
                        <div className="lg:col-span-8 bg-slate-50/50 p-4 sm:p-6 rounded-2xl border border-slate-100 space-y-4">
                          {criteriaAnalysis
                            .filter((item) => item.id === activeCriteriaTab)
                            .map((item) => (
                              <div key={item.id} className="space-y-4">
                                <div className="pb-3 border-b border-slate-200">
                                  <span className="text-[10px] text-blue-600 font-black uppercase tracking-widest">
                                    Đang xem chi tiết câu trả lời
                                  </span>
                                  <h4 className="text-base font-extrabold text-slate-800 mt-1">
                                    {item.title}
                                  </h4>
                                  <p className="text-slate-400 text-xs font-semibold">
                                    Tiêu chí cụ thể: {item.detail}
                                  </p>
                                </div>

                                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                  {item.answers && item.answers.length > 0 ? (
                                    item.answers.map((qa, index) => (
                                      <div
                                        key={index}
                                        className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-2 hover:border-blue-200 transition duration-150"
                                      >
                                        <div className="flex items-start gap-2">
                                          <HelpCircle className="w-4.5 h-4.5 text-slate-400 shrink-0 mt-0.5" />
                                          <span className="text-xs font-bold text-slate-700 leading-snug">
                                            {qa.question}
                                          </span>
                                        </div>
                                        <div className="pl-6.5 text-[11.5px] sm:text-xs text-slate-600 font-medium leading-relaxed border-l-2 border-slate-100 whitespace-pre-line">
                                          {qa.answer}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-center py-10 text-slate-400 text-xs font-medium">
                                      AI chưa bóc tách đủ cho tiêu chí này. Hãy cập nhật lại thông tin ban đầu.
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSegmentTab === "personas" && (
                    <div className="p-4 sm:p-6 space-y-6">
                      <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl flex items-start gap-3">
                        <UserCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold text-emerald-900">
                            Phương Án Gợi Ý: Chọn 1 trong 4 Chân Dung
                          </h4>
                          <p className="text-emerald-700 text-[11px] leading-relaxed mt-0.5 font-medium">
                            Hãy đọc kỹ 4 định dạng nhân khẩu và hành vi dưới dây được đúc kết từ kết quả bóc tách 5 tiêu chí tiền đề của AI. Bấm **Chọn & hiệu chỉnh** để đi tiếp thiết kế định vị bộ USP.
                          </p>
                        </div>
                      </div>

                      {/* Grid of 4 Personas */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {personas.map((persona, index) => (
                          <div
                            key={persona.id}
                            className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden"
                          >
                            {/* Accent Header profile title matching template block style */}
                            <div className="bg-slate-900 p-4 text-white flex items-start justify-between">
                              <div className="space-y-1">
                                <span className="text-[9px] bg-emerald-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">
                                  Chân dung mục tiêu #{index + 1}
                                </span>
                                <h4 className="font-extrabold text-sm sm:text-base text-slate-100 truncate max-w-[240px] sm:max-w-md">
                                  {persona.name}
                                </h4>
                              </div>
                              <div className="p-1.5 bg-slate-800 rounded-md">
                                <Target className="w-4 h-4 text-emerald-400" />
                              </div>
                            </div>

                            {/* Meta specifics */}
                            <div className="p-5 flex-1 space-y-4 text-xs leading-relaxed">
                              <div>
                                <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                  NHÂN KHẨU & HÀNH VI TIÊU CHUẨN
                                </span>
                                <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200/60 font-medium">
                                  {persona.demographics}
                                </p>
                              </div>

                              <div>
                                <span className="block text-[9px] font-bold text-rose-500 uppercase tracking-widest mb-1.5">
                                  NỖI LO SỢ / NỖI ĐAU ĐAU ĐỚN NHẤT
                                </span>
                                <p className="text-slate-800 bg-rose-50/40 p-3 rounded-lg border border-rose-100/60 font-semibold">
                                  {persona.painPoints}
                                </p>
                              </div>

                              <div>
                                <span className="block text-[9px] font-bold text-emerald-600 uppercase tracking-widest mb-1.5">
                                  XÚC CẢM SƯỚNG NHẤT KHUẤY ĐỘNG MUA HÀNG
                                </span>
                                <p className="text-slate-800 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/60 font-semibold">
                                  {persona.benefits}
                                </p>
                              </div>

                              <div className="pt-3 border-t border-slate-100 italic text-slate-500 text-center font-medium">
                                "{persona.summary}"
                              </div>
                            </div>

                            {/* Action selector bottom tab */}
                            <div className="p-4 bg-slate-50 border-t border-slate-100">
                              <button
                                id={`btn-select-persona-${index}`}
                                onClick={() => handleSelectPersona(index)}
                                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-500/10 cursor-pointer transition duration-150"
                              >
                                <UserCheck className="w-4 h-4 text-emerald-100" />
                                <span>Chọn & Hiệu Chỉnh Chân Dung Này</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 3 Page Content layout */}
            {currentStep === 3 && editedPersona && (
              <motion.div
                key="step-3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white p-5 sm:p-7 rounded-2xl border border-slate-200 shadow-sm space-y-6"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest block mb-0.5">
                      Đại diện khách hàng đã chọn
                    </span>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                      Bước 3: Hiệu chỉnh Chân Dung Đích Cho Sát Sườn
                    </h3>
                    <p className="text-slate-500 text-xs sm:text-sm">
                      Sát nhập chỉnh lý các từ ngữ chuyên ngành để định vị sản phẩm đạt tỷ lệ chuyển đổi cao nhất.
                    </p>
                  </div>
                  <button
                    id="btn-back-step3"
                    onClick={() => setCurrentStep(2)}
                    className="px-3.5 py-1.5 text-xs font-bold border border-slate-200 bg-white text-slate-700 rounded-lg hover:bg-slate-100 flex items-center gap-1 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
                    <span>Quay lại</span>
                  </button>
                </div>

                {/* Form Editing panels */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Tên nhóm chân dung
                      </label>
                      <input
                        type="text"
                        value={editedPersona.name}
                        onChange={(e) => setEditedPersona({ ...editedPersona, name: e.target.value })}
                        className="w-full text-sm px-3.5 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Đặc tính xã hội, thu nhập & hành lý tiêu tiền
                      </label>
                      <textarea
                        rows={5}
                        value={editedPersona.demographics}
                        onChange={(e) => setEditedPersona({ ...editedPersona, demographics: e.target.value })}
                        className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-medium leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                        Trích dẫn tuyên khẩu tiêu biểu
                      </label>
                      <input
                        type="text"
                        value={editedPersona.summary}
                        onChange={(e) => setEditedPersona({ ...editedPersona, summary: e.target.value })}
                        className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 italic font-medium text-slate-600"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-rose-500 mb-1.5">
                        Lỗi lo thầm kín / Đau rát rấp khó (Pain Points)
                      </label>
                      <textarea
                        rows={5}
                        value={editedPersona.painPoints}
                        onChange={(e) => setEditedPersona({ ...editedPersona, painPoints: e.target.value })}
                        className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-rose-200 bg-rose-55/15 text-slate-800 focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 font-medium leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-emerald-600 mb-1.5">
                        Ưu thế tối hảo chinh phục sướng thoả
                      </label>
                      <textarea
                        rows={5}
                        value={editedPersona.benefits}
                        onChange={(e) => setEditedPersona({ ...editedPersona, benefits: e.target.value })}
                        className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-emerald-250 bg-emerald-55/15 text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-medium leading-relaxed"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-150 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-slate-400 font-medium">
                    * Tiếp tục kịch bản, AI bóc dỡ 10 bộ USP Định Vị dựa trên điều tệp bạn vừa tinh lọc.
                  </div>
                  
                  <button
                    id="btn-confirm-persona-edits"
                    onClick={handleSavePersonaEdits}
                    disabled={loading}
                    className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Đang khơi mào 10 kịch bản USP (khoảng 10-15s)...</span>
                      </>
                    ) : (
                      <>
                        <span>Tiến hành tạo ra 10 USP độc nhất</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 4 Page Content layout */}
            {currentStep === 4 && (
              <motion.div
                key="step-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* Floating summary tracker widget styled beautifully right at the top */}
                <div className="sticky top-16 z-30 bg-white border border-slate-200 shadow-md p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Target className="w-5 h-5 text-blue-600 shrink-0" />
                      <h4 className="font-extrabold text-slate-900 text-base tracking-tight">
                        Chọn Lọc 5 Cặp USP Thuyết Phục Cho File Master
                      </h4>
                    </div>
                    <p className="text-slate-500 text-xs font-semibold">
                      Nhấn chọn <span className="text-blue-600">chính xác 5 cặp USP</span> tiêu biểu đại diện cho sản phẩm của bạn.
                    </p>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest block">Đã đánh dấu</span>
                      <div className="text-xl font-black text-slate-800">
                        <span className={selectedUsps.length === 5 ? "text-green-600" : "text-amber-500"}>
                          {selectedUsps.length}
                        </span>{" "}
                        / <span className="text-slate-700">5 Cặp</span>
                      </div>
                    </div>

                    <button
                      id="btn-finalize-master"
                      disabled={selectedUsps.length !== 5}
                      onClick={finalizeMasterFile}
                      className={`px-5 py-3 rounded-xl font-black text-xs sm:text-sm shadow-sm transition-all flex items-center gap-1.5 ${
                        selectedUsps.length === 5
                          ? "bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-md shadow-blue-500/25 animate-bounce-slow"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      <CheckCircle2 className="w-4.5 h-4.5" />
                      <span>Xuất File Master</span>
                    </button>
                  </div>
                </div>

                {/* List of 10 USPs Pairings */}
                <div className="space-y-4">
                  {usps.map((item, index) => {
                    const isSelected = selectedUsps.includes(item.id);
                    const isEditing = isEditingUspId === item.id;

                    return (
                      <div
                        key={item.id}
                        className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden ${
                          isSelected ? "border-blue-600 ring-2 ring-blue-500/10 shadow-sm" : "border-slate-200 shadow-xxs"
                        } ${isEditing ? "bg-slate-50/55" : ""}`}
                      >
                        {/* Sub-header card title bar based on mockup styling */}
                        <div className="bg-slate-50 px-5 py-3 border-b border-slate-150 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-slate-900 text-white w-6 h-6 rounded-full font-bold flex items-center justify-center">
                              {index + 1}
                            </span>
                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                              Cặp USP đặc định #{index + 1}
                            </span>
                          </div>

                          <div>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectUsp(item.id)}
                                disabled={!isSelected && selectedUsps.length >= 5}
                                className="w-4.5 h-4.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                              />
                              <span className={`text-xs font-black uppercase tracking-wider ${isSelected ? "text-blue-600" : "text-slate-500"}`}>
                                {isSelected ? "Đã Chọn" : "Tích Chọn"}
                              </span>
                            </label>
                          </div>
                        </div>

                        {/* Card core item body */}
                        <div className="p-5 space-y-4">
                          {isEditing ? (
                            <div className="space-y-3.5 text-xs">
                              <div>
                                <label className="block font-black text-slate-500 uppercase tracking-wider mb-1">
                                  Nỗi lo lắng / Nỗi đau khách hàng
                                </label>
                                <input
                                  type="text"
                                  value={inlinePainPoint}
                                  onChange={(e) => setInlinePainPoint(e.target.value)}
                                  className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>
                              
                              <div>
                                <label className="block font-black text-slate-500 uppercase tracking-wider mb-1">
                                  Định vị / USP độc bản giải thế của sản phẩm
                                </label>
                                <input
                                  type="text"
                                  value={inlineUsp}
                                  onChange={(e) => setInlineUsp(e.target.value)}
                                  className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-lg border border-slate-200 bg-white font-bold text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>

                              <div>
                                <label className="block font-black text-slate-500 uppercase tracking-wider mb-1">
                                  Mô tả chuyển đổi / Thông điệp truyền thông kịch bản
                                </label>
                                <textarea
                                  rows={2}
                                  value={inlineDesc}
                                  onChange={(e) => setInlineDesc(e.target.value)}
                                  className="w-full text-xs px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none"
                                />
                              </div>

                              <div className="flex justify-end gap-2">
                                <button
                                  id={`btn-cancel-edit-usp-${index}`}
                                  onClick={() => setIsEditingUspId(null)}
                                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-xs font-bold hover:bg-slate-100 cursor-pointer"
                                >
                                  Hủy bỏ
                                </button>
                                <button
                                  id={`btn-save-edit-usp-${index}`}
                                  onClick={() => saveInlineEditUsp(item.id)}
                                  className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 cursor-pointer shadow-xs"
                                >
                                  Lưu lại
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 text-xs sm:text-sm">
                              {/* Left side painpoint card with border color */}
                              <div className="md:col-span-5 bg-rose-50/20 p-4 rounded-xl border-l-4 border-l-rose-500 border border-slate-200/50">
                                <span className="block text-[9px] font-bold text-rose-500 uppercase tracking-wider mb-1.5">
                                  NỖI ĐAU CỦA KHÁCH HÀNG:
                                </span>
                                <p className="text-slate-800 leading-relaxed font-bold">
                                  {item.painPoint}
                                </p>
                              </div>

                              {/* Right side solutions card with border color matching reference mockup design */}
                              <div className="md:col-span-7 bg-blue-50/10 p-4 rounded-xl border-l-4 border-l-blue-600 border border-slate-200/50 relative group">
                                <button
                                  id={`btn-edit-usp-${index}`}
                                  onClick={() => startInlineEditUsp(item)}
                                  className="absolute top-3 right-3 text-[10px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 py-1 px-2 rounded-md flex items-center gap-1 shadow-xxs cursor-pointer transition opacity-100 sm:opacity-0 group-hover:opacity-100"
                                >
                                  <Edit2 className="w-2.5 h-2.5" />
                                  <span>Hiệu đính câu chữ</span>
                                </button>

                                <span className="block text-[9px] font-bold text-blue-600 uppercase tracking-wider mb-1.5">
                                  GIẢI PHÁP / USP VƯỢT TRỘI ĐỘC NHẤT:
                                </span>
                                <p className="text-slate-900 leading-relaxed font-black text-sm text-balance">
                                  {item.usp}
                                </p>
                                <p className="text-slate-550 text-xs leading-relaxed mt-2.5 pt-2.5 border-t border-slate-100 italic">
                                  "{item.description}"
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Warning / instructions banners */}
                {selectedUsps.length !== 5 && (
                  <div className="p-4 bg-amber-50 text-amber-900 rounded-xl border border-amber-200 flex items-center gap-2.5 text-xs font-semibold shadow-xxs">
                    <Info className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      Hiện bạn đang chọn <strong>{selectedUsps.length} / 5</strong> cặp USP. Bạn cần lựa chọn chính xác 5 cặp đại diện tuyệt vời nhất để AI kết dính thành bàn File Master hoàn chỉnh.
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* Step 5 Page Content layout */}
            {currentStep === 5 && (
              <motion.div
                key="step-5"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 print:bg-white print:p-0"
              >
                {/* Header Actions dashboard box styled beautifully like mockup headers */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900 text-white p-6 sm:p-7 rounded-2xl border border-slate-800 shadow-md print:hidden relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
                  
                  <div className="space-y-1">
                    <span className="text-[10px] bg-green-500 text-slate-950 font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest block w-max mb-1.5">
                      TIẾN TRÌNH ĐÃ HOÀN TẤT
                    </span>
                    <h3 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-100">
                      Bản Phê Duyệt File Master Độc Quyền USP
                    </h3>
                    <p className="text-slate-400 text-xs max-w-xl">
                      Dữ liệu đã đóng gói sẵn để đưa trực tiếp vào kịch bản Telesale, tài liệu đào tạo Đại lý, hoặc chạy chiến dịch truyền thông chuyển đổi.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 z-10">
                    <button
                      id="btn-copy-clipboard"
                      onClick={handleCopyToClipboard}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xxs"
                    >
                      {copySuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                      <span>{copySuccess ? "Đã sao chép!" : "Copy Báo Cáo"}</span>
                    </button>

                    <button
                      id="btn-download-csv"
                      onClick={handleDownloadCSV}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <Download className="w-4 h-4" />
                      <span>Xuất Excel/CSV</span>
                    </button>

                    <button
                      id="btn-print"
                      onClick={() => window.print()}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xxs"
                    >
                      <Printer className="w-4 h-4 text-slate-400" />
                      <span>In Bản Cứng</span>
                    </button>
                  </div>
                </div>

                {/* Google NotebookLM Integration Toolkit Card */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-150 p-6 rounded-2xl print:hidden space-y-4 shadow-xxs">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs shrink-0 mt-0.5">
                        <BookOpen className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">Kích Hoạt Tài Nguyên Google NotebookLM</h4>
                          <span className="text-[9px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-widest leading-none">Mở Rộng Đăng Ký AI</span>
                        </div>
                        <p className="text-slate-650 text-xs leading-relaxed max-w-2xl font-medium">
                          Google NotebookLM là công cụ ghi chú thông minh tuyệt đỉnh. Bạn có thể nạp toàn bộ kết quả File Master USP này để tự động tạo <strong>Audio Podcast đối thoại</strong>, chatbot trả lời chuyên sâu, kịch bản video ngắn, bài viết PR chuẩn xác nhất.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href="https://notebooklm.google"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shadow-sm shadow-indigo-500/20"
                      >
                        <span>Truy cập NotebookLM</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Action 1: Download Source */}
                    <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 hover:border-blue-400/50 transition flex flex-col justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-blue-600" />
                          <span>1. Tải Tệp Nguồn (.txt)</span>
                        </div>
                        <p className="text-slate-550 text-[11px] leading-relaxed font-semibold">
                          Tải file văn bản được thiết kế cấu trúc tối ưu cho AI của NotebookLM đọc hiểu thấu đáo nhất.
                        </p>
                      </div>
                      <button
                        onClick={handleDownloadNotebookLM}
                        className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải tệp nguồn cho NotebookLM</span>
                      </button>
                    </div>

                    {/* Action 2: Copy Raw Text */}
                    <div className="bg-white/80 backdrop-blur-xs p-4 rounded-xl border border-slate-200/60 hover:border-blue-400/50 transition flex flex-col justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="font-bold text-slate-850 text-xs flex items-center gap-1.5">
                          <Copy className="w-4 h-4 text-blue-600" />
                          <span>2. Copy Chọn & Paste Nhanh</span>
                        </div>
                        <p className="text-slate-550 text-[11px] leading-relaxed font-semibold">
                          Sao chép văn bản nguồn cực nhanh bằng 1 click để paste trực tiếp vào Thêm nguồn (Pasted text) của NotebookLM.
                        </p>
                      </div>
                      <button
                        onClick={handleCopyNotebookLM}
                        className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        {copyNotebookSuccess ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                        <span>{copyNotebookSuccess ? "Đã sao chép nguồn!" : "Sao chép nhanh nguồn dịch"}</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-[11px] text-slate-600 leading-snug font-medium">
                    <strong>💡 Hướng dẫn nhanh:</strong> Truy cập <strong>notebooklm.google</strong> → Tạo một Notebook mới → Chọn Thêm Nguồn (Add Source) → Chọn Tệp đã tải/Dán văn bản đã copy → Sử dụng tính năng <em>"Audio Overview"</em> ở góc phải để sinh audio podcast tiếng Anh hoàn hảo phân tích định vị sản phẩm của bạn.
                  </div>
                </div>

                {/* Paper blueprint showcase matches reference styling beautifully */}
                <div id="capture-blueprint-master" className="bg-white p-6 sm:p-9 rounded-2xl border border-slate-200 shadow-sm space-y-8 print:border-none print:shadow-none font-sans">
                  
                  {/* Brand Header printed header visual only */}
                  <div className="hidden print:block text-center pb-6 border-b border-slate-300">
                    <h2 className="text-2xl font-black text-slate-900 uppercase">BẢN CHỨNG FILE MASTER ĐỊNH VỊ</h2>
                    <p className="text-xs text-slate-500">Phê duyệt và phân phối nội bộ chiến dịch sản phẩm v2.0</p>
                  </div>

                  {/* Top info bento boxes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    
                    {/* Basic specs block card */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 pb-2.5 border-b border-slate-100">
                        <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                        <h4 className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">I. Thông Tin Cơ Bản Sản Phẩm</h4>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-0.5">TÊN SẢN PHẨM KHAI BÁO:</span>
                          <div className="font-black text-slate-900 text-lg sm:text-xl text-balance">{productName}</div>
                        </div>

                        {productImage && (
                          <div className="w-full h-44 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center sm:max-w-xs shadow-xxs">
                            <img
                              src={productImage}
                              alt={productName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}


                      </div>
                    </div>

                    {/* Target persona summary block */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 pb-2.5 border-b border-slate-104">
                        <UserCheck className="w-5 h-5 text-blue-600" />
                        <h4 className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">II. Tiêu Điểm Chân Dung Khách Hàng</h4>
                      </div>

                      {editedPersona && (
                        <div className="space-y-3.5 text-xs leading-relaxed font-semibold">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-0.5">MÃ DANH NHÓM CHỌN:</span>
                            <div className="font-extrabold text-slate-900 sm:text-sm">{editedPersona.name}</div>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">NHÂN KHẨU VÀ HÀNH VI:</span>
                            <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-150 font-medium">{editedPersona.demographics}</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-rose-500 font-bold uppercase tracking-widest block mb-1">NỖI ĐAU ĐỊNH MỆNH / BỨC XÚC NHẤT:</span>
                            <p className="text-slate-800 bg-rose-50/20 p-3 rounded-lg border border-rose-100/50 font-bold">{editedPersona.painPoints}</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest block mb-1">XÚC CẢM TIÊU DÙNG THỎA MÁT:</span>
                            <p className="text-slate-800 bg-emerald-50/20 p-3 rounded-lg border border-emerald-100/50 font-bold">{editedPersona.benefits}</p>
                          </div>

                          <div className="pt-2 italic text-slate-500 text-center font-bold border-t border-slate-100">
                            "{editedPersona.summary}"
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Section 3: Master Definitive 8-Stage Marketing Blueprint Table */}
                  <div className="space-y-5 pt-6 border-t border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
                      <div className="flex items-center gap-2">
                        <Target className="w-5 h-5 text-blue-600" />
                        <h4 className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight uppercase">
                          III. BẢNG CHIẾN LƯỢC ĐỊNH VỊ MARKETING (8 CỘT HOÀN CHỈNH)
                        </h4>
                      </div>
                      <div className="text-[11px] text-blue-100 font-bold bg-slate-800 px-3 py-1 rounded-full border border-slate-700 flex items-center gap-1 shrink-0 print:hidden shadow-xs">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                        <span>💡 Bạn có thể click trực tiếp vào ô bất kỳ để biên tập câu chữ nhanh chóng trước khi xuất file</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-xs bg-white print:border-none print:shadow-none">
                      <table className="min-w-[1700px] lg:w-full border-collapse divide-y divide-slate-200 table-fixed">
                        <thead className="bg-slate-50 print:bg-slate-100">
                          <tr>
                            <th className="w-[70px] px-3 py-3.5 text-center text-xs font-black text-slate-500 uppercase tracking-wider">STT</th>
                            <th className="w-[200px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Bước (Step)</th>
                            <th className="w-[220px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Mục Tiêu Tâm Lý</th>
                            <th className="w-[260px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Nỗi Đau & Mong Muốn</th>
                            <th className="w-[260px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Các bước</th>
                            <th className="w-[300px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">{"USP (Lợi ích -> Tính năng)"}</th>
                            <th className="w-[240px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Headline - Subheadline</th>
                            <th className="w-[250px] px-3 py-3.5 text-left text-xs font-black text-slate-500 uppercase tracking-wider">Minh họa hình ảnh (Visual Key)</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200 divide-x divide-slate-100">
                          {reportRows.map((row, index) => (
                            <tr key={index} className="hover:bg-slate-50/40 transition duration-150">
                              {/* STT */}
                              <td className="px-2 py-4 text-center">
                                <input
                                  type="number"
                                  value={row.stt}
                                  onChange={(e) => handleUpdateRowCell(index, "stt", e.target.value)}
                                  className="w-full text-center text-xs font-bold text-slate-700 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded p-1 print:p-0"
                                />
                              </td>

                              {/* Bước (Step) */}
                              <td className="px-2 py-3 bg-slate-50/30">
                                <textarea
                                  rows={3}
                                  value={row.step}
                                  onChange={(e) => handleUpdateRowCell(index, "step", e.target.value)}
                                  className="w-full text-xs font-black text-blue-900 bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-none leading-snug print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* Mục Tiêu Tâm Lý */}
                              <td className="px-2 py-3">
                                <textarea
                                  rows={4}
                                  value={row.psychologicalGoal}
                                  onChange={(e) => handleUpdateRowCell(index, "psychologicalGoal", e.target.value)}
                                  className="w-full text-xs text-slate-700 font-medium bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-relaxed print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* Nỗi Đau & Mong Muốn */}
                              <td className="px-2 py-3 bg-rose-50/10">
                                <textarea
                                  rows={4}
                                  value={row.painPointAndDesire}
                                  onChange={(e) => handleUpdateRowCell(index, "painPointAndDesire", e.target.value)}
                                  className="w-full text-xs text-slate-800 font-semibold bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-relaxed print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* Các bước */}
                              <td className="px-2 py-3">
                                <textarea
                                  rows={4}
                                  value={row.stepsDetail}
                                  onChange={(e) => handleUpdateRowCell(index, "stepsDetail", e.target.value)}
                                  className="w-full text-xs text-slate-700 bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-relaxed print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* USP (Lợi ích -> Tính năng) */}
                              <td className="px-2 py-3 bg-blue-50/10">
                                <textarea
                                  rows={4}
                                  value={row.uspDetail}
                                  onChange={(e) => handleUpdateRowCell(index, "uspDetail", e.target.value)}
                                  className="w-full text-xs text-blue-900 font-bold bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-relaxed print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* Headline - Subheadline */}
                              <td className="px-2 py-3">
                                <textarea
                                  rows={3}
                                  value={row.headlineSubheadline}
                                  onChange={(e) => handleUpdateRowCell(index, "headlineSubheadline", e.target.value)}
                                  className="w-full text-xs text-slate-900 font-black tracking-tight bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-snug print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>

                              {/* Minh họa hình ảnh */}
                              <td className="px-2 py-3">
                                <textarea
                                  rows={3}
                                  value={row.visualKey}
                                  onChange={(e) => handleUpdateRowCell(index, "visualKey", e.target.value)}
                                  className="w-full text-xs text-slate-600 bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-500 hover:bg-white focus:bg-white focus:ring-1 focus:ring-blue-500 rounded p-1.5 resize-y leading-relaxed print:border-none print:resize-none print:p-0 print:bg-transparent"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-205 text-center text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                    BÀN GIAO THƯƠNG HIỆU MARKETING - KIẾN TẠO NGÀY {new Date().toLocaleDateString("vi-VN")}
                  </div>
                </div>

                {/* Back CTA control block */}
                <div className="flex justify-center items-center py-6 print:hidden">
                  <button
                    id="btn-restart-flow"
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-6 py-3 border border-slate-200 text-slate-700 bg-white hover:bg-slate-100 rounded-xl text-xs sm:text-sm font-bold transition duration-150 cursor-pointer shadow-xxs"
                  >
                    <RefreshCw className="w-4 h-4 text-slate-500 animate-spin-slow" />
                    <span>Lên dự án mới</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Footer bar styled exactly like professional reference design */}
      <footer className="h-12 bg-slate-900 flex flex-col sm:flex-row items-center justify-between px-4 sm:px-8 text-white text-[10px] font-medium tracking-wider flex-shrink-0 gap-1.5 py-1 sm:py-0 print:hidden border-t border-slate-800">
        <div className="flex items-center gap-3 sm:gap-6">
          <span className="font-extrabold uppercase text-slate-350">HỆ THỐNG MASTER FILE SẢN PHẨM v2.0</span>
          <span className="opacity-30">|</span>
          <span className="text-slate-450">MÃ SỐ DỰ ÁN: PROD-882-AF</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-blue-400 font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping"></span>
            Tự động lưu: {new Date().toLocaleTimeString("vi-VN")}
          </span>
        </div>
      </footer>
    </div>
  );
}

// Inline pure SVG component to represent a neat photo camera icon
function PhotoIconPlaceholder() {
  return (
    <svg className="w-8 h-8 text-slate-300 mb-1" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.115-.744.074-1.08-.131M5.186 7.23c-.38.115-.744.074-1.08-.131m0 0L3 6.13M1.08-.13c-.38-.115-.74-.074-1.08.13M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
