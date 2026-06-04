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
app.use(express.json({ limit: "15mb" }));

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
      const { productName, productDescription, productBase64Image } = req.body;
      if (!productName || !productDescription) {
        return res.status(400).json({ error: "Vui lòng điền tên và mô tả sản phẩm." });
      }

      const client = getGeminiClient();

      const baseInstruction = `
        Bạn là chuyên gia xuất sắc về Quản trị Trải nghiệm Khách hàng (CX) kiêm Giám đốc Nghiên cứu Thị trường kỳ cựu.
        Sản phẩm cần phân tích: Tên: "${productName}" | Mô tả chi tiết: "${productDescription}"

        NHIỆM VỤ CỦA BẠN GỒM 2 PHẦN CHÍNH:

        PHẦN 1: BẢN PHÂN TÍCH 5 TIÊU CHÍ KINH ĐIỂN TRƯỚC KHI LẬP CHÂN DUNG
        Hãy trả lời thấu đáo từng câu hỏi trong bộ câu hỏi dưới đây dựa trên dữ liệu sản phẩm, tài liệu tải lên để tìm ra câu trả lời thuyết phục nhất cho từng tiêu chí:
        
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
        Từ kết quả phân tích 5 tiêu chí trên, hãy đúc kết ra 4 chân dung khách hàng lý tưởng độc lập đại diện cho các trường hợp điển hình nhất.
        Đảm bảo mỗi chân dung tập trung phân khúc khác biệt nhưng đều có liên quan mật thiết đến giá trị của sản phẩm.
        
        Toàn bộ nội dung trả về viết dưới dạng JSON có cấu trúc chính xác theo schema bên dưới và dịch thuật tiếng Việt chuẩn chỉnh, tự nhiên, chuyên sâu.
      `;

      let contents: any[] = [{ text: baseInstruction }];

      // Attach base64 image if user uploaded one to provide product context (Multimodal input)
      if (productBase64Image) {
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

      const client = getGeminiClient();

      const promptText = `
        Sản phẩm: "${productName}"
        Mô tả sản phẩm: "${productDescription}"

        Chân dung khách hàng được lựa chọn và tinh chỉnh:
        - Tên đối tượng: ${selectedPersona.name}
        - Đặc điểm nhân khẩu: ${selectedPersona.demographics}
        - Nỗi đau cốt lõi: ${selectedPersona.painPoints}
        - Lợi ích mong mỏi: ${selectedPersona.benefits}
        - Châm ngôn: ${selectedPersona.summary}

        NHIỆM VỤ:
        Từ thông tin chân dung khách hàng đặc thù trên kết hợp với tính năng của sản phẩm, hãy phân tích chuyên sâu nhằm đưa ra đúng 10 cặp "Nỗi đau khách hàng - Giải pháp USP tương ứng".
        Mỗi cặp phải thể hiện một góc nhìn tâm lý thực tế, bóc tách dòng suy nghĩ cản trở họ và khắc phục triệt để bằng một lợi điểm bán hàng độc nhất (USP) thực thụ từ sản phẩm.
        Ngôn ngữ cần thuyết phục, sắc bén, nhắm trúng tim đen người dùng và viết hoàn toàn bằng tiếng Việt.

        Yêu cầu từng phần tử:
        - painPoint: Nỗi đau cụ thể, sự băn khoăn hay sự bất tiện thực tế mà đối tượng gặp phải (nêu rõ ngữ cảnh bức xúc).
        - usp: Lợi điểm bán hàng độc nhất / tính năng đặc hữu giúp xử lý dứt điểm nỗi lo/nỗi đau đó một cách vượt trội.
        - description: Giải thích ngắn gọn cách thức sản phẩm mang lại giải pháp đó một cách tinh tế kèm một khẩu hiệu kêu gọi hoặc ví dụ trực quan.
      `;

      const response = await generateContentWithFallback({
        contents: promptText,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "Bạn là chuyên gia lập kế hoạch định vị thương hiệu và viết lời quảng cáo Copywriter đỉnh cao tại Việt Nam.",
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

      const client = getGeminiClient();

      const promptText = `
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
        Từ 5 cặp Nỗi đau & USP ban đầu này, hãy tinh luyện thành một bảng chiến lược định hình 5 giai đoạn hoặc kịch bản bước tiếp cận khách hàng xuất sắc. Hãy điền câu trả lời chi tiết bằng TIẾNG VIỆT vào cấu trúc JSON bên dưới. Hãy phân tích chuyên sâu sao cho:
        1. stt: Số thứ tự từ 1 đến 5.
        2. step: Tên bước hành trình, ví dụ: "Bước 1: Tiếp cận & Săn đón sự tò mò", "Bước 2: Phá vỡ sự hoài nghi về chất lượng", vv.
        3. psychologicalGoal: Mục Tiêu Tâm Lý sâu xa của người tiêu dùng trong giai đoạn mua hàng này.
        4. painPointAndDesire: Bày tỏ rõ Nỗi Đau & Mong Muốn của họ bằng lời lẽ chân thực nhất.
        5. stepsDetail: Các bước: Các hành động cụ thể hoặc cách tiếp cận để người dùng tương tác chuyển đổi.
        6. uspDetail: USP: Thể hiện rõ mô hình (Lợi ích khách hàng -> Thông số kỹ thuật cụ thể của sản phẩm).
        7. headlineSubheadline: Headline - Subheadline: Sáng tạo một tiêu đề giật gân (Headline) đi liền với phụ đề (Subheadline) lôi cuốn để hiển thị chữ trên ảnh.
        8. visualKey: Minh họa hình ảnh (Visual Key): Gợi ý phân cảnh chụp/vẽ hoặc bối cảnh hình ảnh trực quan thể hiện giá trị sản phẩm tốt nhất.
      `;

      const response = await generateContentWithFallback({
          contents: promptText,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction: "Bạn là giám đốc chiến lược hình ảnh thương hiệu và Copywriter bậc thầy tại Việt Nam. Trả lời chi tiết, chuyên nghiệp và có chiều sâu.",
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
                  visualKey: { type: Type.STRING },
                },
                required: ["stt", "step", "psychologicalGoal", "painPointAndDesire", "stepsDetail", "uspDetail", "headlineSubheadline", "visualKey"]
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

  // API endpoint for generating a product concept image mock-up using gemini-2.5-flash-image
  app.post("/api/generate-image", async (req, res) => {
    try {
      const { productName, productDescription } = req.body;
      if (!productName || !productDescription) {
        return res.status(400).json({ error: "Vui lòng nhập tên và mô tả sản phẩm để thiết kế ảnh mô phỏng." });
      }

      const client = getGeminiClient();

      const imagePrompt = `
        Generate a professional, high-quality, product-oriented e-commerce advertising concept vector/illustration showcasing the product "${productName}". 
        Description context: "${productDescription}".
        Style: clean, hyper-modern, minimalist, elegant lighting, studio background, perfect color palette matching the product vibe. Underlined by professional commercial design principles. No messy texts or watermarks inside.
      `;

      const response = await generateContentWithFallback({
        contents: imagePrompt,
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
        modelPreference: ["gemini-2.5-flash-image", "gemini-3.1-flash-image"],
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
