/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

let aiInstance: GoogleGenAI | null = null;

// Lazy initialization of Gemini client to prevent crash if key is missing on start
function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not defined. Please configure GEMINI_API_KEY in your environment first.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// Wrapper to automatically handle rate limits / free tier quotas (429 RESOURCE_EXHAUSTED)
// with fallback models (gemini-3.5-flash -> gemini-3.1-flash-lite -> gemini-flash-latest)
async function generateContentWithFallback(params: {
  contents: any;
  config?: any;
  modelPreference?: string[];
}): Promise<any> {
  const client = getGeminiClient();
  const modelsToTry = params.modelPreference || ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
  
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[Gemini API] Attempting generation with model: ${model}`);
      const modelConfig = params.config ? { ...params.config } : undefined;
      // Strip thinkingConfig if the model does not start with gemini-3
      if (modelConfig && modelConfig.thinkingConfig && !model.startsWith("gemini-3")) {
        delete modelConfig.thinkingConfig;
      }

      const res = await client.models.generateContent({
        contents: params.contents,
        model: model,
        config: modelConfig,
      });
      return res;
    } catch (err: any) {
      lastError = err;
      const isQuotaError = 
        err?.status === 429 || 
        err?.statusCode === 429 ||
        err?.message?.includes("RESOURCE_EXHAUSTED") ||
        JSON.stringify(err)?.includes("RESOURCE_EXHAUSTED") ||
        JSON.stringify(err)?.includes("quota");

      if (isQuotaError) {
        console.warn(`[Gemini API] Model ${model} rate-limited or quota exhausted. Trying next fallback...`);
        continue;
      } else {
        throw err;
      }
    }
  }

  // If all tried models failed with rate limit/quota, return a helpful friendly message
  const isQuotaError = 
    lastError?.status === 429 || 
    lastError?.statusCode === 429 ||
    lastError?.message?.includes("RESOURCE_EXHAUSTED") ||
    JSON.stringify(lastError)?.includes("RESOURCE_EXHAUSTED") ||
    JSON.stringify(lastError)?.includes("quota");

  if (isQuotaError) {
    throw new Error(
      "Hệ thống hiện tại đã vượt quá giới hạn lượt yêu cầu miễn phí của Google Gemini (Quota Exceeded - 429). " +
      "Vui lòng đợi khoảng 1 phút rồi thử lại, hoặc tự cấu hình phím API cá nhân (GEMINI_API_KEY) của riêng bạn trong Settings > Secrets để sử dụng không giới hạn."
    );
  }

  throw lastError || new Error("Đã xảy ra lỗi không xác định khi gọi dịch vụ AI.");
}

const app = express();
const PORT = 3000;

// Use JSON payload deserialization with limit configured for image upload/transmission
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

  // Global error/payload too large handler to log issues and return clean JSON to client instead of HTML
  app.use((err: any, req: any, res: any, next: any) => {
    if (err) {
      const errorMsg = `[${new Date().toISOString()}] Global express middleware error: ${err.message}\n${err.stack}\n\n`;
      try {
        fs.appendFileSync(path.join(process.cwd(), "error_logs.txt"), errorMsg);
      } catch (writeErr) {
        console.error("Failed to write to logs:", writeErr);
      }
      console.error("Global Express Error:", err);
      return res.status(err.status || err.statusCode || 500).json({ error: err.message || "Lỗi xử lý yêu cầu tải dữ liệu." });
    }
    next();
  });

  app.get("/api/debug", (req, res) => {
    res.json({
      hasApiKey: !!process.env.GEMINI_API_KEY,
      apiKeyLength: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
      env: process.env.NODE_ENV || "development"
    });
  });

  // API endpoint for generating 5 Criteria analysis with questions & 4 Customer Personas based on Product details
  app.post("/api/personas", async (req, res) => {
    try {
      const { productName, productDescription, productBase64Image, productBase64Images } = req.body;
      if (!productName || !productDescription) {
        return res.status(400).json({ error: "Vui lòng điền tên và mô tả sản phẩm." });
      }

      let agentsMd = "";
      let painPointMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
        painPointMd = fs.readFileSync(path.join(process.cwd(), "PAIN_POINT_ANALYSIS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      const client = getGeminiClient();

      const baseInstruction = `
        HIỂN PHÁP COPYWRITING VÀ ĐỊNH HÌNH VĂN PHONG:
        ${agentsMd}

        FRAMEWORK KỸ THUẬT PHÂN TÍCH NỖI ĐAU VÀ CHÂN DUNG KHÁCH HÀNG:
        ${painPointMd}

        ========================

        Bạn là chuyên gia xuất sắc về Quản trị Trải nghiệm Khách hàng (CX) kiêm Giám đốc Chiến lược Thương hiệu.
        Sản phẩm cần phân tích: Tên: "${productName}" | Mô tả chi tiết, thông số và tính năng của sản phẩm: "${productDescription}"

        QUY TẮC PHÂN TÍCH QUAN TRỌNG:
        1. Hãy phân tích chuyên sâu các thông số kỹ thuật, đặc tính và tính năng cụ thể của sản phẩm trong phần mô tả đi kèm.
        2. Nếu có hình ảnh sản phẩm đính kèm (hỗ trợ nhiều góc độ hình ảnh khác nhau), hãy quan sát kĩ kiểu dáng, bao bì, thiết kế đồ họa của sản phẩm để đánh giá định vị thương hiệu trực quan một cách chính xác nhất.
        3. Thực hiện so sánh ngầm hoặc trực tiếp sản phẩm này với các giải pháp thay thế đang có trên thị trường hiện nay nhằm xác định định vị độc đáo và đối điểm định vị sắc nét. Từ đó, đưa ra các gợi ý chân dung khách hàng và câu trả lời khảo sát chính xác tuyệt đối, đúng trọng tâm nhất, tránh các mô tả chung chung lý thuyết.

        NHIỆM VỤ CỦA BẠN GỒM 2 PHẦN CHÍNH:

        PHẦN 1: BẢN PHÂN TÍCH 5 TIÊU CHÍ KINH ĐIỂN TRƯỚC KHI LẬP CHÂN DUNG
        Hãy trả lời thấu đáo từng câu hỏi trong bộ câu hỏi dưới đây dựa trên dữ liệu sản phẩm, tài liệu tải lên để tìm ra câu trả lời thuyết phục nhất cho từng tiêu chí, gắn kết chặt chẽ với thế mạnh cạnh tranh sau khi so sánh thị trường:
        
        1. Tiêu chí: "Xác định khu vực khách hàng mục tiêu" (Chi tiết: Quốc gia/ Khu vực/ Thành phố...)
           Các câu hỏi cần trả lời:
           - Khách hàng của bạn đến từ khu vực nào (quốc gia, khu vực, thành phố)?
           - Khu vực này có đặc điểm gì nổi bật (khí hậu, văn hóa, kinh tế)?
           - Tập trung nhiều ở khu dân cư nào hoặc các địa điểm cụ thể nào (chợ, khu công nghiệp, văn phòng, trường học, trung tâm thương mại)?
           - Những đặc điểm văn hóa địa phương nào ảnh hưởng đến quyết định mua hàng của khách hàng?
           - Khách hàng có dễ dàng tiếp cận các cửa hàng phân phối của bạn không?

        2. Tiêu chí: "Xác định đặc điểm nhân khẩu học của khách hàng" (Chi tiết: Tuổi/ Giới tính/ SL thành viên trong gia đình/ Nghề nghiệp/ Thu nhập...)
           Các câu hỏi cần trả lời:
           - Khách hàng thuộc độ tuổi nào? Giới tính của họ là gì?
           - Họ có bao nhiêu thành viên trong gia đình?
           - Nghề nghiệp của khách hàng là gì (văn phòng, lao động tay chân, freelancer, doanh nhân...)?
           - Mức thu nhập trung bình của họ ra sao? Trình độ học vấn của khách hàng thế nào?
           - Tình trạng hôn nhân của họ (độc thân, đã kết hôn, có con)?
           - Vai trò của họ trong gia đình (người ra quyết định mua hàng hay người hỗ trợ)?
           - Họ có sở thích hoặc thói quen chi tiêu gì đặc biệt liên quan đến lối sống (tiết kiệm, thích hàng cao cấp...)?

        3. Tiêu chí: "Hiểu thói quen và hành vi mua sắm" (Chi tiết: Các lý do mua hàng, dịp sử dụng, lợi ích tìm kiếm, cách sử dụng, thói quen sử dụng)
           Các câu hỏi cần trả lời:
           - Họ thường mua sản phẩm ở đâu (cửa hàng, online, siêu thị)?
           - Họ thường mua sắm vào khung giờ nào (giờ làm việc, giờ tối, cuối tuần)?
           - Lý do chính họ mua sản phẩm là gì (tự sử dụng, mua cho ai, làm quà tặng, cải thiện sức khỏe)?
           - Họ tìm kiếm thông tin sản phẩm ở đâu (website, mạng xã hội, người quen)?
           - Họ có những tiêu chí gì khi lựa chọn sản phẩm (giá cả, chất lượng, thương hiệu)?
           - Sản phẩm của bạn được khách hàng sử dụng trong dịp nào (sinh nhật, lễ hội, sử dụng hàng ngày)?
           - Họ có thường mua sản phẩm qua các chương trình khuyến mãi hoặc dịp lễ hội không?
           - Họ có bị ảnh hưởng bởi ý kiến từ người thân, bạn bè, hoặc KOL/Influencer không?
           - Họ có thường so sánh giá cả và chất lượng sản phẩm trước khi mua không?

        4. Tiêu chí: "Khám phá insight của khách hàng" (Chi tiết: Nhu cầu chưa được đáp ứng (Unmet need)/ Nỗi đau của khách hàng (Painpoint)/ Dữ liệu thông tin)
           Các câu hỏi cần trả lời:
           - Khách hàng của bạn gặp khó khăn gì chưa được giải quyết (unmet need)?
           - Điều gì khiến họ không hài lòng với các sản phẩm/dịch vụ hiện tại trên thị trường?
           - Điều họ sợ mất đi hoặc không đạt được khi mua sản phẩm?
           - Điều gì làm khách hàng cảm thấy hài lòng nhất khi sử dụng sản phẩm/dịch vụ hiện tại?
           - Khách hàng mong muốn sản phẩm/dịch vụ có thêm tính năng hoặc lợi ích gì?
           - Khách hàng cần giải pháp gì để vượt qua khó khăn hiện tại mà sản phẩm của bạn có thể đáp ứng?
           - Động lực lớn nhất để khách hàng sẵn sàng thay đổi thói quen và thử một sản phẩm mới là gì?
           - Dữ liệu nào bạn có thể thu thập từ khách hàng (qua khảo sát, lịch sử mua hàng, phỏng vấn sâu)?

        5. Tiêu chí: "Phân tích rào cản tài chính & Uy tín quyết định" (Chi tiết: Rào cản chi phí, bảo chứng dịch vụ cam kết, xu thế thay thế tạm thời)
           Các câu hỏi cần trả lời:
           - Khách hàng có rào cản gì về giá hoặc ngân sách đầu tư ban đầu?
           - Họ lo sợ gì về dịch vụ hậu mãi hay độ bền thực tế của sản phẩm?
           - Yếu tố thương hiệu thầm kín nào giúp họ tự tin công nhận giải pháp của bạn?
           - Sự bảo chứng hoặc chính sách đổi trả nào sẽ gỡ bỏ 100% rào cản phòng vệ của họ?

        PHẦN 2: PHÁC HỌA 4 CHÂN DUNG KHÁCH HÀNG LÝ TƯỞNG (PERSONAS)
        Từ kết quả phân tích 5 tiêu chí trên kết hợp với kết quả so sánh định vị sản phẩm trên thị trường, hãy đúc kết ra 4 chân dung khách hàng lý tưởng độc lập đại diện cho các đối tượng cốt lõi nhất.
        Đảm bảo mỗi chân dung tập trung phân khúc khác biệt nhưng đều nhắm trúng các ưu điểm, thông số kỹ thuật thực tế và tính công dụng thực tế của sản phẩm.
        
        Toàn bộ nội dung trả về viết dưới dạng JSON có cấu trúc chính xác theo schema bên dưới và dịch thuật tiếng Việt chuẩn chỉnh, tự nhiên, chuyên sâu.
      `;

      let contents: any[] = [{ text: baseInstruction }];

      // Attach base64 images if user uploaded multiple views
      if (productBase64Images && Array.isArray(productBase64Images) && productBase64Images.length > 0) {
        productBase64Images.forEach((base64) => {
          if (base64) {
            const cleanedImage = base64.replace(/^data:image\/\w+;base64,/, "");
            contents.push({
              inlineData: {
                mimeType: "image/png",
                data: cleanedImage,
              },
            });
          }
        });
      } else if (productBase64Image) {
        // Strip data prefix if any
        const cleanedImage = productBase64Image.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanedImage,
          },
        });
      }

      const response = await generateContentWithFallback({
        contents: { parts: contents },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "Bạn là trưởng bộ phận nghiên cứu thị trường có am hiểu chuyên sâu về hành vi người tiêu dùng Việt Nam, luôn cung cấp câu trả lời khách quan, rõ nghĩa, chi tiết sâu sắc.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              analysis: {
                type: Type.ARRAY,
                description: "Phần tích lũy của AI cho 5 tiêu chí lớn với đáp án cho toàn bộ câu hỏi",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "Mã tiêu chí, ví dụ criteria-1" },
                    title: { type: Type.STRING, description: "Tên tiêu chí" },
                    detail: { type: Type.STRING, description: "Chi tiết định danh tiêu chí" },
                    answers: {
                      type: Type.ARRAY,
                      description: "List câu hỏi và giải pháp câu trả lời tương ứng",
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          question: { type: Type.STRING },
                          answer: { type: Type.STRING }
                        },
                        required: ["question", "answer"]
                      }
                    }
                  },
                  required: ["id", "title", "detail", "answers"]
                }
              },
              personas: {
                type: Type.ARRAY,
                description: "Mảng danh sách cấu trúc chứa chính xác 4 chân dung khách hàng tiềm năng khác biệt nhau dựa trên phân tích ở trên",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Tên chân dung khách hàng kèm thứ tự (Ví dụ: Chân dung 1: ...)" },
                    demographics: { type: Type.STRING, description: "Mô tả chi tiết các chỉ số nhân khẩu học, độ tuổi, hành vi mua sắm" },
                    painPoints: { type: Type.STRING, description: "Các thách thức, vấn đề bức bối hoặc nỗi lo âu lớn nhất của họ" },
                    benefits: { type: Type.STRING, description: "Giải pháp, quyền lợi và giá trị thực chất họ tìm thấy ở sản phẩm" },
                    summary: { type: Type.STRING, description: "Câu nói cốt lõi hoặc châm ngôn tiêu biểu của chân dung này khi chọn mua sản phẩm" },
                  },
                  required: ["name", "demographics", "painPoints", "benefits", "summary"],
                },
              }
            },
            required: ["analysis", "personas"]
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Không nhận được dữ liệu phản hồi cấu trúc từ mô hình AI.");
      }

      const result = JSON.parse(responseText.trim());
      res.json({
        analysis: result.analysis || [],
        personas: result.personas || []
      });
    } catch (error: any) {
      const errorMsg = `[${new Date().toISOString()}] Error in /api/personas: ${error?.message}\n${error?.stack}\n\n`;
      try {
        fs.appendFileSync(path.join(process.cwd(), "error_logs.txt"), errorMsg);
      } catch (writeErr) {
        console.error("Failed to write to error_logs.txt:", writeErr);
      }
      console.error("Error generating personas and analysis:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi trong quá trình phân tích chân dung khách hàng." });
    }
  });

  // API endpoint to generate 10 pairs of customer pain points & USPs based on selected and modified persona
  app.post("/api/usps", async (req, res) => {
    try {
      const { productName, productDescription, selectedPersona } = req.body;
      if (!productName || !selectedPersona) {
        return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin sản phẩm và chân dung khách hàng đã chọn." });
      }

      let agentsMd = "";
      let painPointMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
        painPointMd = fs.readFileSync(path.join(process.cwd(), "PAIN_POINT_ANALYSIS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      const client = getGeminiClient();

      const promptText = `
        HIỂN PHÁP COPYWRITING VÀ ĐỊNH HÌNH VĂN PHONG:
        ${agentsMd}

        FRAMEWORK KỸ THUẬT PHÂN TÍCH NỖI ĐAU:
        ${painPointMd}

        ========================
        
        Sản phẩm: "${productName}"
        Mô tả sản phẩm: "${productDescription}"

        Chân dung khách hàng được lựa chọn và tinh chỉnh:
        - Tên đối tượng: ${selectedPersona.name}
        - Đặc điểm nhân khẩu: ${selectedPersona.demographics}
        - Nỗi đau cốt lõi: ${selectedPersona.painPoints}
        - Lợi ích mong mỏi: ${selectedPersona.benefits}
        - Châm ngôn: ${selectedPersona.summary}

        NHIỆM VỤ:
        Từ thông tin chân dung định vị và phân tích sâu sắc bằng FRAMEWORK PHÂN TÍCH NỖI ĐAU 7 BƯỚC ở trên:
        Bước 1: Bắt nguồn từ 'vấn đề đời sống' của họ.
        Bước 2: Tách thông số (Specs) -> Lợi ích Tính năng (Functional) -> Lợi ích Cảm xúc (Emotional).
        Bước 3: Đưa ra 10 cặp "Nỗi đau khách hàng - Giải pháp USP tương ứng".

        Yêu cầu văn bản: Thực tế, sắc gọn, không sáo rỗng. Bỏ qua các từ như "tuyệt vời", "hoàn hảo", "người bạn đồng hành". Dịch các thông số kỹ thuật thành bằng chứng bán hàng cụ thể theo đúng quy tắc ở HIẾN PHÁP COPYWRITING.


        Yêu cầu từng phần tử:
        - painPoint: Nỗi đau cụ thể, sự băn khoăn hay sự bất tiện thực tế mà đối tượng gặp phải (Ví dụ bối cảnh hằng ngày). Không hù dọa quá đà.
        - usp: Lợi điểm bán hàng độc nhất (USP) sắc bén dùng bằng chứng cụ thể để xử lý nỗi đau.
        - description: Giải thích cách mà Thông số kỹ thuật (Spec) -> Tính năng -> Mang lại lợi ích cảm xúc cho khách. Đi kèm một câu chốt (Key Message) mang tính định vị.
      `;

      const response = await generateContentWithFallback({
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "Bạn là chuyên gia quy hoạch USP và Copywriter tiếp thị chuyển đổi. Viết văn phong thực tế, sắc bén, có số liệu hóa, đánh vào insight đời thực, tuyệt đối không dùng văn mẫu chung chung.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "Cung cấp danh sách đúng 10 phác thảo cụ thể về nỗi đau khách hàng và kèm theo Unique Selling Point (USP) tương thích",
            items: {
              type: Type.OBJECT,
              properties: {
                painPoint: { type: Type.STRING, description: "Nỗi đau, trăn trở, nghi ngờ hay sự bất tiện cực độ" },
                usp: { type: Type.STRING, description: "Lợi điểm bán hàng sắc bén xử lý dứt điểm nỗi đau trên" },
                description: { type: Type.STRING, description: "Lời lý giải tường tận cách thức triển khai và thông điệp truyền tải" },
              },
              required: ["painPoint", "usp", "description"],
            },
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Không nhận được dữ liệu cấu trúc USPs từ mô hình AI.");
      }

      const usps = JSON.parse(responseText.trim());
      res.json({ usps });
    } catch (error: any) {
      const errorMsg = `[${new Date().toISOString()}] Error in /api/usps: ${error?.message}\n${error?.stack}\n\n`;
      try {
        fs.appendFileSync(path.join(process.cwd(), "error_logs.txt"), errorMsg);
      } catch (writeErr) {
        console.error("Failed to write to error_logs.txt:", writeErr);
      }
      console.error("Error generating USPs:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi trong quá trình phân tích 10 USP." });
    }
  });

  // API endpoint for translating 5 USPs into the structured 8-column master board
  app.post("/api/finalize-master", async (req, res) => {
    try {
      const { productName, productDescription, selectedPersona, selectedUsps } = req.body;
      if (!productName || !selectedPersona || !selectedUsps || selectedUsps.length !== 5) {
        return res.status(400).json({ error: "Yêu cầu đầy đủ tên sản phẩm, chân dung và chính xác 5 USP được chọn." });
      }

      let agentsMd = "";
      let painPointMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
        painPointMd = fs.readFileSync(path.join(process.cwd(), "PAIN_POINT_ANALYSIS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      const client = getGeminiClient();

      const promptText = `
        HIỂN PHÁP COPYWRITING VÀ ĐỊNH HÌNH VĂN PHONG:
        ${agentsMd}

        FRAMEWORK KỸ THUẬT PHÂN TÍCH NỖI ĐAU:
        ${painPointMd}

        ========================

        Sản phẩm: "${productName}"
        Mô tả: "${productDescription}"

        Chân dung khách hàng:
        - Tên đối tượng: ${selectedPersona.name}
        - Đặc điểm: ${selectedPersona.demographics}
        - Nỗi đau hành vi: ${selectedPersona.painPoints}
        - Lợi ước: ${selectedPersona.benefits}

        Danh sách chính xác 5 cặp Nỗi Đau & USP được chọn dưới đây:
        ${selectedUsps.map((item: any, idx: number) => `
        [Cặp USP #${idx + 1}]
        - Nỗi đau: ${item.painPoint}
        - Giải pháp USP: ${item.usp}
        - Mô tả: ${item.description}
        `).join("\n")}

        NHIỆM VỤ:
        Từ 5 cặp Nỗi đau & USP ban đầu này, hãy tinh luyện thành một bảng chiến lược định hình 5 giai đoạn nội dung theo phễu tiếp thị (Awareness -> Consideration -> Conversion -> Retention). Điền câu trả lời chi tiết bằng TIẾNG VIỆT vào cấu trúc JSON bên dưới.

        YÊU CẦU MỞ RỘNG (Dựa trên Hiến pháp Copywriting):
        - Không bán bằng cách nói sản phẩm "tốt". Bán bằng cách chứng minh sản phẩm giúp khách hàng sống nhẹ nhàng hơn.
        - Tránh xa văn mẫu AI ("nâng tầm không gian sống", "người bạn đồng hành").
        - Dùng số liệu như một bằng chứng. Dịch Thông số -> Tác động thực tế -> Lợi ích cảm xúc.

        Chi tiết các cột:
        1. stt: Số thứ tự từ 1 đến 5.
        2. step: Tên bước theo phễu (VD: "Bước 1: Awareness - Gọi tên vấn đề", "Bước 3: Conversion - Thúc đẩy hành động").
        3. psychologicalGoal: Mục Tiêu Tâm Lý sâu xa (Phá vỡ niềm tin cũ, giải quyết rào cản giá, v.v).
        4. painPointAndDesire: Bày tỏ rõ Nỗi Đau & Mong Muốn bằng lời lẽ chân thực nhất.
        5. stepsDetail: Content Angle (Góc tiếp cận nội dung), ví dụ "An toàn không chỉ có inox". Trả lời câu hỏi: Sau khi đọc, khách hàng nên làm gì ngay? (CTA).
        6. uspDetail: USP: Thể hiện rõ mô hình (Thông số kỹ thuật -> Lợi ích chức năng -> Lợi ích cảm xúc).
        7. headlineSubheadline: Yêu cầu định dạng: Bắt buộc tách rõ "Headline: [Nội dung]" và "Subheadline: [Nội dung]".
           - Headline (TỪ 6-12 TỪ, có lực, 1 điểm neo rõ ràng). Chọn 1 trong 5 mô hình:
             + [Pain Point trực diện]: VD: "An toàn không chỉ có inox", "Đừng để chiếc chảo làm khó bữa ăn"
             + [Lợi ích rõ ràng]: VD: "Ít dầu hơn, bếp sạch hơn", "Lau một lần, sạch lòng chảo"
             + [Chuyển đổi nhận thức]: VD: "Đã đến lúc hiểu đúng về ceramic", "Không phải chống dính nào cũng giống nhau"
             + [Cảm xúc gia đình]: VD: "Bữa ăn an toàn bắt đầu từ căn bếp", "Để mỗi bữa cơm nhẹ nhàng hơn"
             + [Deal/CTA ngắn gọn]: VD: "Trải nghiệm ngay, quà liền tay", "Săn deal chuẩn Âu"
           - Subheadline (Làm rõ "vì sao nên tin"): Bắt buộc phải có lý do cụ thể (công nghệ, chứng nhận, con số, trải nghiệm) để bổ trợ Headline. Kết thúc bằng 1 CTA ngắn gọn hành động. Cấu trúc chuẩn: Headline cảm xúc -> Subheadline lý tính -> CTA hành động.
        8. visualKey: Minh họa hình ảnh (Visual Key) hướng tới bối cảnh CÔNG DỤNG đời thực của sản phẩm. Không mô tả lộn xộn, chỉ tập trung vào một khung cảnh chân thực, rõ ràng để AI sinh ảnh Midjourney/Stable Diffusion có thể vẽ chính xác.
        9. postContent: Đoạn nội dung copywriting chi tiết, thực chiến cho phần này. Bạn phải viết sao cho người dùng có thể DỄ DÀNG COPY PASTE gộp nối tiếp postContent từ Bước 1 đến Bước 5 để tạo thành MỘT BÀI VIẾT PR / Kịch bản Landing Page xuyên suốt hoàn chỉnh:
           - Ở Bước 1: Bắt buộc mở đầu bằng 1-2 câu "Lời Mở Đầu / Hook" bắt từ insight đời sống, sau đó trình bày vấn đề.
           - Ở Bước 2, 3, 4: Bắt buộc mở đầu đoạn bằng "Câu nối, từ nối chuyển ý" (Ví dụ: "Không chỉ vậy...", "Chưa dừng lại ở đó...", "Một điều nữa khiến...", "Nhưng điều quan trọng nhất là...") tạo sự liên kết logic mượt mà liền mạch với đoạn trên.
           - Ở Bước 5: Viết đoạn kết luận tự nhiên và một lời chốt sales (Call to action) rành rọt, thuyết phục đóng lại bài.
           - Giọng văn: Tuân thủ tuyệt đối quy tắc tại HIẾN PHÁP COPYWRITING (thực tế, sắc gọn, cảm xúc, phân tích Spec -> Benefit).
      `;

      const response = await generateContentWithFallback({
          contents: promptText,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction: "Bạn là Giám đốc Chiến lược Thương hiệu và Copywriter Conversion-marketing đỉnh cao. Viết cực gọn, đánh trúng tâm lý, thiết lập headline 6-12 từ mạnh mẽ, tuyệt đối tuân thủ ngôn ngữ tiếp thị sắc bén.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              description: "Danh sách chính xác 5 bước hành trình phân tích theo cấu trúc biểu mẫu",
              items: {
                type: Type.OBJECT,
                properties: {
                  stt: { type: Type.INTEGER },
                  step: { type: Type.STRING },
                  psychologicalGoal: { type: Type.STRING },
                  painPointAndDesire: { type: Type.STRING },
                  stepsDetail: { type: Type.STRING },
                  uspDetail: { type: Type.STRING },
                  headlineSubheadline: { type: Type.STRING },
                  visualKey: { 
                    type: Type.STRING, 
                    description: "Mô tả hình ảnh trực quan sinh động hướng tới CÔNG DỤNG thực tế của sản phẩm một cách dễ hiểu để AI tạo ảnh vẽ được bối cảnh chân thực từ đó" 
                  },
                  postContent: {
                    type: Type.STRING,
                    description: "Đoạn Copywriting hoàn chỉnh cho mục này. Bước 1 có Mở Bài. Bước 2, 3, 4 dùng câu nối để liên kết liền mạch với đoạn trước. Bước 5 có chốt CTA."
                  }
                },
                required: ["stt", "step", "psychologicalGoal", "painPointAndDesire", "stepsDetail", "uspDetail", "headlineSubheadline", "visualKey", "postContent"]
              }
            }
          }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Không nhận được phản hồi cấu trúc từ AI.");
      }

      const reportRows = JSON.parse(responseText.trim());
      res.json({ reportRows });

    } catch (error: any) {
      console.error("Error finalizing master rows:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi trong quá trình biên dịch 5 kịch bản định vị." });
    }
  });

  // API endpoint for syncing files / Dispatching to Google Drive Automation Webhooks
  app.post("/api/gdrive-sync", async (req, res) => {
    try {
      const { syncMethod, fileBase64, filename, webhookUrl } = req.body;
      
      if (!syncMethod || !fileBase64 || !filename) {
        return res.status(400).json({ error: "Thiếu thông tin đồng bộ (syncMethod, fileBase64 hoặc filename)." });
      }

      if (syncMethod === "webhook") {
        if (!webhookUrl) {
          return res.status(400).json({ error: "Thiếu địa chỉ Webhook trigger URL." });
        }

        console.log("Google Drive Sync: Dispatching to webhook URL:", webhookUrl);
        const webhookRes = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename,
            fileData: fileBase64,
            source: "AI-Brand-Strategy-Hub",
            timestamp: new Date().toISOString()
          }),
        });

        if (!webhookRes.ok) {
          const errMsg = await webhookRes.text();
          return res.status(500).json({ 
            error: `Kích hoạt Webhook thất bại (${webhookRes.status}). Chi tiết: ${errMsg.substring(0, 200)}` 
          });
        }

        let linkUrl = "";
        try {
          const resData: any = await webhookRes.json();
          linkUrl = resData.link || resData.url || resData.webUrl || resData.webViewLink || "";
        } catch (_) {
          // If no JSON was returned, that's okay, since webhooks can return text/plain or empty
        }

        return res.json({
          status: "success",
          webUrl: linkUrl || null,
          message: "Kích hoạt Webhook thành công! Quá trình tự động đang đẩy tập tin lên Google Drive của bạn."
        });
      } else {
        return res.status(400).json({ error: "Phương thức đồng bộ không hợp lệ." });
      }

    } catch (err: any) {
      console.error("Critical error in /api/gdrive-sync:", err);
      res.status(500).json({ error: err?.message || "Đã xảy ra lỗi nghiêm trọng khi đồng bộ." });
    }
  });

  // API endpoint for generating a product concept image mock-up using high-quality paid model gemini-3.1-flash-image
  app.post("/api/generate-image", async (req, res) => {
    try {
      const { productName, productDescription } = req.body;
      if (!productName || !productDescription) {
        return res.status(400).json({ error: "Vui lòng nhập tên và mô tả sản phẩm để thiết kế ảnh mô phỏng." });
      }

      let agentsMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      const client = getGeminiClient();

      const imagePrompt = `
        HIẾN PHÁP QUY CHUẨN ĐẦU RA HÌNH ẢNH:
        ${agentsMd}
        
        ========================================
        Generate a professional, high-quality, product-oriented e-commerce advertising concept vector/illustration showcasing the product "${productName}". 
        Description context: "${productDescription}".
        Style: clean, hyper-modern, minimalist, elegant lighting, studio background, perfect color palette matching the product vibe. Underlined by professional commercial design principles. No messy texts or watermarks inside.
      `;

      const response = await generateContentWithFallback({
        contents: imagePrompt,
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
        },
        modelPreference: ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"],
      });

      let base64Image = "";
      const candidates = response.candidates;
      if (candidates && candidates[0]?.content?.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            base64Image = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!base64Image) {
        throw new Error("Mô hình AI vẽ ảnh chưa phản hồi dữ liệu nhị phân tương thích.");
      }

      res.json({ imageUrl: base64Image });
    } catch (error: any) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi khi tự động chuyển hướng thiết kế ảnh minh họa bằng AI." });
    }
  });

  // API endpoint for generating a composite mockup of the 5 visual elements based on the product images
  app.post("/api/generate-composite-image", async (req, res) => {
    try {
      const { productName, productImage, productImages, visualKeys } = req.body;
      if (!productName || !visualKeys || !Array.isArray(visualKeys) || visualKeys.length === 0) {
        return res.status(400).json({ error: "Thiếu thông tin sản phẩm hoặc mô tả 5 yếu tố để tạo ảnh." });
      }

      let agentsMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      console.log(`[Gemini API] Request received to generate composite key image based on ${visualKeys.length} items`);
      const client = getGeminiClient();

      // build descriptive text of the 5 elements
      const elementsText = visualKeys.map((vk: string, idx: number) => `Yếu tố ${idx + 1}: ${vk}`).join("\n");

      const imagePrompt = `
        HIẾN PHÁP QUY CHUẨN ĐẦU RA HÌNH ẢNH:
        ${agentsMd}
        
        ========================================
        Bạn là bậc thầy thiết kế quảng cáo thương mại và chuyên gia đồ họa hình ảnh sản phẩm xuất sắc nhất.
        NHIỆM VỤ QUAN TRỌNG NHẤT: Tạo ra một hình ảnh quảng cáo thể hiện chính xác sản phẩm có thương hiệu "${productName}" ở trung tâm ảnh, được bao quanh bởi các hình ảnh chức năng mô tả công dụng thực tế của 5 yếu tố "Visual Key" bên dưới.

        YÊU CẦU BẮT BUỘC VỀ SẢN PHẨM CHÍNH (QUAN TRỌNG SỐ 1):
        - Giữ nguyên bản tuyệt đối 100% hình dạng kết cấu, chất liệu vỏ hộp/thân máy, chi tiết nhãn mác và màu sắc đặc trưng của sản phẩm chính từ những hình ảnh chụp đầu vào có sẵn. Tuyệt đối không thay đổi kiểu dáng gốc, không biến đổi logo và màu sắc của thương hiệu.
        - Sản phẩm chính phải nằm ở vị trí tiêu điểm (Hero Product) trung tâm nổi bật, được chiếu sáng bằng ánh sáng studio (studio lighting) cao cấp chuyên nghiệp.

        YÊU CẦU VỀ 5 BẢN VẼ MÔ TẢ CHỨC NĂNG (VISUAL KEY):
        - Các yếu tố nhỏ hay các phân cảnh phụ đi kèm xung quanh tuyệt đối KHÔNG ĐƯỢC thiết kế dưới dạng hộp quà hay vỏ hộp 3D hư cấu, mà bắt buộc phải là các bức ảnh phân cảnh thực tế sử dụng (lifestyle/functional action scenes) mô tả sinh động hiệu quả/ứng dụng trực quan của 5 công năng sau:
        ${elementsText}
        - Mỗi phân cảnh phụ này mô tả trực diện bối cảnh thực tiễn mà sản phẩm phát huy tối đa công hiệu, giúp khách hàng thấu hiểu ngay giải pháp thực sự từ các góc nhìn khác nhau.

        PHONG CÁCH MỸ THUẬT:
        - Commercial product advertising photography. Bố cục ngăn nắp, sang trọng, màu sắc hài hòa và đồng nhất tuyệt đối với màu sắc chủ đạo của dòng sản phẩm gốc.
        - Chi tiết hiển thị cực kỳ sắc nét, chuyên nghiệp, không có văn bản bị méo mó hay ký tự rác vô nghĩa.
      `;

      let contents: any[] = [];

      // Add multiple angles of the product if uploaded
      if (productImages && Array.isArray(productImages) && productImages.length > 0) {
        productImages.forEach((img) => {
          if (img) {
            const cleanedImage = img.replace(/^data:image\/\w+;base64,/, "");
            contents.push({
              inlineData: {
                mimeType: "image/png",
                data: cleanedImage,
              },
            });
          }
        });
      } else if (productImage) {
        const cleanedImage = productImage.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanedImage,
          },
        });
      }

      contents.push({ text: imagePrompt });

      const response = await generateContentWithFallback({
        contents: { parts: contents },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
        },
        modelPreference: ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"],
      });

      let base64Image = "";
      const candidates = response.candidates;
      if (candidates && candidates[0]?.content?.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            base64Image = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!base64Image) {
        throw new Error("Mô hình AI vẽ ảnh chưa phản hồi dữ liệu nhị phân tương thích.");
      }

      res.json({ imageUrl: base64Image });
    } catch (error: any) {
      console.error("Error generating composite image:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi khi tạo ảnh mô tả 5 yếu tố bằng AI." });
    }
  });

  // API endpoint for generating a targeted, economical individual functional image for a specific USP row
  app.post("/api/generate-individual-image", async (req, res) => {
    try {
      const { productName, productImage, productImages, visualKey, uspDetail, painPointAndDesire } = req.body;
      if (!productName || !visualKey) {
        return res.status(400).json({ error: "Thiếu thông tin tên sản phẩm hoặc mô tả Visual Key." });
      }

      let agentsMd = "";
      try {
        agentsMd = fs.readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf-8");
      } catch (err) {
        console.warn("Could not read MD files", err);
      }

      console.log(`[Gemini API] Generating targeted individual USP image for visual: ${visualKey}`);
      const client = getGeminiClient();

      const imagePrompt = `
        HIẾN PHÁP QUY CHUẨN ĐẦU RA HÌNH ẢNH:
        ${agentsMd}
        
        ========================================
        Bạn là bậc thầy đồ họa thương mại chuyên thiết kế ảnh quảng cáo ứng dụng thực tế cho dòng sản phẩm "${productName}".
        
        NHIỆM VỤ: Vẽ 1 bức ảnh chụp quảng cáo đơn lẻ tập trung mô tả CHỨC NĂNG VÀ HIỆU QUẢ THỰC TẾ của sản phẩm tương ứng với yếu tố Visual Key sau:
        - Mô tả Visual Key: "${visualKey}"
        ${uspDetail ? `- Chi tiết USP: "${uspDetail}"` : ""}
        ${painPointAndDesire ? `- Nỗi đau giải quyết: "${painPointAndDesire}"` : ""}

        YÊU CẦU QUAN TRỌNG VỀ SẢN PHẨM GỐC:
        - Giữ nguyên bản tuyệt đối 100% hình dạng kết cấu, nhãn mác thương hiệu, logo và tông màu chủ đạo của sản phẩm có trong các bức ảnh chụp đính kèm.
        - Sản phẩm thực tế chính là trung tâm hoặc xuất hiện tương tác trực tiếp trong bối cảnh sử dụng.
        
        YÊU CẦU VỀ BAO BÌ VÀ DỰNG HỘP (PACKAGING MOCKUP):
        - Nếu phần mô tả hoặc ảnh chụp đính kèm có chứa hình dạng bao bì bản in phẳng (flat print design/layout hoặc vỏ hộp giấy), hãy khéo léo bọc (wrap/mockup) họa tiết in ấn đó lên một chiếc hộp 3D thực tế sang trọng nhất để mô phỏng hình ảnh vỏ hộp của sản phẩm một cách chuẩn chỉnh không tì vết.

        YÊU CẦU MỸ THUẬT:
        - Không vẽ các hộp quà hư cấu hay các ký hiệu rác. Hãy vẽ một bức ảnh Lifestyle bối cảnh tự nhiên cao cấp (chụp quảng cáo studio thương mại chuyên nghiệp).
        - Màu sắc hài hòa bắt mắt, ánh sáng phản chiếu chân thực lên bề mặt sản phẩm và vỏ hộp. Không có chữ viết bị méo mộc hay biến dạng trên ảnh được tạo ra.
      `;

      let contents: any[] = [];

      // Add all available angles of input images for maximum accuracy
      if (productImages && Array.isArray(productImages) && productImages.length > 0) {
        productImages.forEach((img) => {
          if (img) {
            const cleanedImage = img.replace(/^data:image\/\w+;base64,/, "");
            contents.push({
              inlineData: {
                mimeType: "image/png",
                data: cleanedImage,
              },
            });
          }
        });
      } else if (productImage) {
        const cleanedImage = productImage.replace(/^data:image\/\w+;base64,/, "");
        contents.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanedImage,
          },
        });
      }

      contents.push({ text: imagePrompt });

      // Using gemini-3.1-flash-image as the high-quality model default matching the 5-element composite setup
      const response = await generateContentWithFallback({
        contents: { parts: contents },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: "1K"
          },
        },
        modelPreference: ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"],
      });

      let base64Image = "";
      const candidates = response.candidates;
      if (candidates && candidates[0]?.content?.parts) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            base64Image = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!base64Image) {
        throw new Error("Không nhận được phản hồi hình ảnh hợp lệ từ mô hình AI cao cấp.");
      }

      res.json({ imageUrl: base64Image });
    } catch (error: any) {
      console.error("Error generating individual USP image:", error);
      res.status(500).json({ error: error?.message || "Đã xảy ra lỗi khi tạo ảnh minh họa USP đơn lẻ bằng AI." });
    }
  });

async function startListening() {
  // Vite development middleware integration or static serve - skip if on Vercel serverless
  if (!process.env.VERCEL) {
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      // Serve static frontend assets in production mode
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Express custom server running on port ${PORT}`);
    });
  }
}

startListening();

export default app;
