import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import {
  generateProductAnswer,
  NO_PRODUCT_ANSWER,
  searchProducts,
  type ProductSource,
  type ProductWithCategory,
} from '../lib/rag';
import { normalizeSearchText } from '../utils/search';

const chat = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// =====================================================
// TYPES
// =====================================================

type ChatBody = {
  message?: unknown;
};

type ProductType = {
  label: string;
  keywords: string[];
};

// =====================================================
// LOẠI SẢN PHẨM
// Dùng để hiểu các câu như "màn hình rẻ nhất",
// "chuột đắt nhất", "bàn phím dưới 1 triệu".
// Từ khóa viết ở dạng không dấu, chữ thường.
// =====================================================

const PRODUCT_TYPES: ProductType[] = [
  { label: 'màn hình', keywords: ['man hinh', 'monitor'] },
  { label: 'chuột', keywords: ['chuot', 'mouse'] },
  { label: 'bàn phím', keywords: ['ban phim', 'keyboard'] },
  { label: 'tai nghe', keywords: ['tai nghe', 'headphone', 'headset'] },
  { label: 'PC', keywords: ['pc', 'may tinh', 'may bo'] },
];

// =====================================================
// HELPER
// =====================================================

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPrice(price: number) {
  return (
    new Intl.NumberFormat('vi-VN').format(price) + 'đ'
  );
}

function containsKeyword(text: string, keyword: string) {
  return new RegExp(`(^|[^a-z0-9])${keyword}($|[^a-z0-9])`).test(text);
}

function detectProductType(q: string): ProductType | null {
  return (
    PRODUCT_TYPES.find((type) =>
      type.keywords.some((keyword) => containsKeyword(q, keyword))
    ) ?? null
  );
}

// Khớp theo cả tên sản phẩm lẫn tên danh mục để không phụ thuộc
// hoàn toàn vào category_id (sản phẩm có thể chưa được phân loại).
function matchesProductType(
  product: ProductWithCategory,
  type: ProductType
) {
  const text = normalizeSearchText(
    `${product.name} ${product.category_name ?? ''}`
  );

  return type.keywords.some((keyword) => containsKeyword(text, keyword));
}

function toSources(
  products: ProductWithCategory[]
): ProductSource[] {
  return products.map((product) => ({
    product_id: product.id,
    name: product.name,
    price: product.price,
    stock: product.stock,
    image_url: product.image_url ?? null,
    category_name: product.category_name ?? null,
  }));
}

async function getProducts(
  env: Env,
  sql: string,
  params: unknown[] = []
): Promise<ProductWithCategory[]> {
  const statement = env.DB.prepare(sql);

  const { results } =
    params.length > 0
      ? await statement
          .bind(...params)
          .all<ProductWithCategory>()
      : await statement.all<ProductWithCategory>();

  return results ?? [];
}

const PRODUCT_SELECT = `
  SELECT
    p.*,
    c.name AS category_name
  FROM products p
  LEFT JOIN categories c
    ON c.id = p.category_id
`;

// Lấy sản phẩm còn hàng, lọc theo loại sản phẩm (nếu câu hỏi có nhắc tới).
async function getInStockProducts(
  env: Env,
  type: ProductType | null
): Promise<ProductWithCategory[]> {
  const products = await getProducts(
    env,
    `${PRODUCT_SELECT} WHERE p.stock > 0`
  );

  return type
    ? products.filter((product) => matchesProductType(product, type))
    : products;
}

// =====================================================
// TÁCH GIÁ TỪ CÂU HỎI
// Ví dụ:
// "dưới 2 triệu", "dưới 2,5 triệu", "dưới 2tr5"
// "dưới 500k", "dưới 500.000đ"
// =====================================================

function extractMoney(text: string): number | null {
  // Không dùng normalizeText vì hàm đó xoá dấu "." và ","
  // khiến "2.5 triệu" bị hiểu thành 25 triệu.
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');

  const toNumber = (value: string) =>
    Number(value.replace(',', '.'));

  const shortMillionMatch = normalized.match(
    /(\d+)\s*tr\s*(\d)\b/
  );

  if (shortMillionMatch) {
    return (
      Number(shortMillionMatch[1]) * 1_000_000 +
      Number(shortMillionMatch[2]) * 100_000
    );
  }

  const millionMatch = normalized.match(
    /(\d+(?:[.,]\d+)?)\s*(trieu|tr)\b/
  );

  if (millionMatch) {
    return toNumber(millionMatch[1]) * 1_000_000;
  }

  const thousandMatch = normalized.match(
    /(\d+(?:[.,]\d+)?)\s*(nghin|ngan|k)\b/
  );

  if (thousandMatch) {
    return toNumber(thousandMatch[1]) * 1_000;
  }

  // Số tiền đầy đủ: "500.000đ", "1,500,000 vnd", "800000 dong"
  const fullMatch = normalized.match(
    /(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(d|dong|vnd)?\b/
  );

  if (fullMatch) {
    return Number(fullMatch[1].replace(/[.,]/g, ''));
  }

  return null;
}

// =====================================================
// ROUTE
// =====================================================

chat.post('/', async (c) => {
  const body = await c.req
    .json<ChatBody>()
    .catch(() => ({} as ChatBody));

  const message =
    typeof body.message === 'string'
      ? body.message.trim()
      : '';

  // ===================================================
  // 1. VALIDATE
  // ===================================================

  if (!message) {
    return c.json(
      {
        error: 'Vui lòng nhập câu hỏi.',
      },
      400
    );
  }

  if (message.length > 500) {
    return c.json(
      {
        error:
          'Câu hỏi không được vượt quá 500 ký tự.',
      },
      400
    );
  }

  // ===================================================
  // 2. RATE LIMIT
  // ===================================================

  const ipAddress =
    c.req.header('CF-Connecting-IP') ??
    'unknown';

  const { success } =
    await c.env.CHAT_RATE_LIMITER.limit({
      key: ipAddress,
    });

  if (!success) {
    return c.json(
      {
        error:
          'Bạn gửi quá nhiều câu hỏi. Vui lòng thử lại sau một phút.',
      },
      429
    );
  }

  try {
    const q = normalizeText(message);

    // =================================================
    // 3. CHÀO HỎI
    // =================================================

    const greetings = [
      'xin chao',
      'chao',
      'hello',
      'hi',
      'hey',
      'alo',
      'chao shop',
      'xin chao shop',
    ];

    if (greetings.includes(q)) {
      return c.json({
        answer:
          'Xin chào! Tôi là trợ lý Đức Thắng. ' +
          'Tôi có thể giúp bạn tìm sản phẩm, so sánh sản phẩm, ' +
          'kiểm tra giá, tồn kho, tư vấn mua hàng và hướng dẫn sử dụng cửa hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 4. CHATBOT LÀM ĐƯỢC GÌ?
    // =================================================

    if (
      q.includes('ban lam duoc gi') ||
      q.includes('chatbot lam duoc gi') ||
      q.includes('giup duoc gi') ||
      q.includes('ho tro gi')
    ) {
      return c.json({
        answer:
          'Tôi có thể giúp bạn tìm và tư vấn sản phẩm, ' +
          'kiểm tra giá và tồn kho, tìm sản phẩm rẻ hoặc đắt nhất, ' +
          'so sánh sản phẩm, gợi ý theo nhu cầu/ngân sách, ' +
          'hướng dẫn thêm vào giỏ, mua ngay, thanh toán, ' +
          'xem sản phẩm yêu thích và theo dõi đơn hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 5. HƯỚNG DẪN THANH TOÁN
    // =================================================

    if (
      q.includes('thanh toan') ||
      q.includes('cach tra tien') ||
      q.includes('tra tien nhu the nao')
    ) {
      return c.json({
        answer:
          'Để thanh toán, bạn hãy chọn sản phẩm muốn mua → ' +
          'nhấn "Thêm vào giỏ" hoặc "Mua ngay" → ' +
          'kiểm tra sản phẩm và số lượng → ' +
          'tiến hành thanh toán → nhập thông tin nhận hàng ' +
          'và chọn phương thức thanh toán mà website đang hỗ trợ → ' +
          'xác nhận đặt hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 6. HƯỚNG DẪN GIỎ HÀNG
    // =================================================

    if (
      q.includes('them vao gio') ||
      q.includes('gio hang') ||
      q.includes('them gio')
    ) {
      return c.json({
        answer:
          'Để thêm sản phẩm vào giỏ hàng, bạn tìm sản phẩm muốn mua ' +
          'và nhấn "Thêm vào giỏ". Sau đó mở mục "Giỏ hàng" ' +
          'trên thanh menu để xem sản phẩm, thay đổi số lượng ' +
          'và tiếp tục thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 7. HƯỚNG DẪN MUA NGAY
    // =================================================

    if (
      q.includes('mua ngay') ||
      q.includes('cach mua') ||
      q.includes('mua nhu the nao') ||
      q.includes('lam sao de mua') ||
      q.includes('huong dan mua') ||
      q.includes('cach dat hang')
    ) {
      return c.json({
        answer:
          'Bạn có thể mua theo 2 cách. ' +
          'Nếu chỉ muốn mua nhanh một sản phẩm, hãy nhấn "Mua ngay". ' +
          'Nếu muốn mua nhiều sản phẩm, hãy nhấn "Thêm vào giỏ", ' +
          'sau đó mở "Giỏ hàng" và tiến hành thanh toán.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 8. HƯỚNG DẪN XEM ĐƠN
    // =================================================

    if (
      q.includes('don cua toi') ||
      q.includes('xem don hang') ||
      q.includes('theo doi don') ||
      q.includes('kiem tra don hang') ||
      q.includes('don hang cua toi')
    ) {
      return c.json({
        answer:
          'Bạn mở mục "Đơn của tôi" trên thanh menu để xem ' +
          'danh sách đơn hàng và trạng thái các đơn đã đặt.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 9. HƯỚNG DẪN YÊU THÍCH
    // =================================================

    if (
      q.includes('yeu thich') ||
      q.includes('them yeu thich')
    ) {
      return c.json({
        answer:
          'Bạn nhấn biểu tượng trái tim trên sản phẩm để thêm vào ' +
          'danh sách yêu thích. Sau đó mở mục "Yêu thích" ' +
          'trên thanh menu để xem lại các sản phẩm đã lưu.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 10. ĐĂNG NHẬP
    // =================================================

    if (
      q.includes('dang nhap') ||
      q.includes('login')
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng nhập", nhập tài khoản và mật khẩu ' +
          'đã đăng ký rồi nhấn nút đăng nhập. ' +
          'Nếu chưa có tài khoản, bạn cần đăng ký trước.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 11. ĐĂNG KÝ
    // =================================================

    if (
      q.includes('dang ky') ||
      q.includes('tao tai khoan')
    ) {
      return c.json({
        answer:
          'Bạn mở trang "Đăng ký", nhập các thông tin được yêu cầu ' +
          'và tạo tài khoản. Sau khi đăng ký thành công, ' +
          'bạn có thể đăng nhập để mua hàng và xem đơn hàng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 12. TÌM KIẾM / LỌC
    // =================================================

    if (
      q.includes('cach tim san pham') ||
      q.includes('tim kiem nhu the nao') ||
      q.includes('cach loc san pham')
    ) {
      return c.json({
        answer:
          'Bạn có thể nhập tên sản phẩm vào ô tìm kiếm. ' +
          'Ngoài ra, cửa hàng có thể lọc theo danh mục, khoảng giá ' +
          'và sắp xếp sản phẩm để giúp bạn tìm nhanh hơn.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 13. NHU CẦU TƯ VẤN CHUNG
    // =================================================

    const generalShoppingRequests = [
      'mua hang',
      'toi muon mua hang',
      'muon mua hang',
      'tu van',
      'tu van cho toi',
      'tu van san pham',
      'toi can tu van',
      'toi muon mua san pham',
      'muon mua san pham',
      'toi can mua san pham',
    ];

    if (
      generalShoppingRequests.includes(q)
    ) {
      return c.json({
        answer:
          'Được chứ! Bạn hãy cho tôi biết loại sản phẩm, ' +
          'mục đích sử dụng hoặc ngân sách. Ví dụ: ' +
          '"Tư vấn chuột gaming dưới 2 triệu" hoặc ' +
          '"Tôi cần màn hình để chơi game".',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 14. RẺ NHẤT / ĐẮT NHẤT
    // Có lọc theo loại sản phẩm nếu câu hỏi nhắc tới,
    // ví dụ: "giá màn hình rẻ nhất" chỉ xét màn hình.
    // =================================================

    const productType = detectProductType(q);
    const typeLabel = productType?.label ?? 'sản phẩm';

    const askCheapest =
      q.includes('re nhat') ||
      q.includes('gia thap nhat');

    const askMostExpensive =
      q.includes('dat nhat') ||
      q.includes('gia cao nhat');

    if (askCheapest || askMostExpensive) {
      const products = (
        await getInStockProducts(c.env, productType)
      )
        .sort((a, b) =>
          askCheapest ? a.price - b.price : b.price - a.price
        )
        .slice(0, 3);

      if (products.length === 0) {
        return c.json({
          answer: productType
            ? `Hiện tại cửa hàng chưa có ${typeLabel} nào còn hàng.`
            : 'Hiện tại cửa hàng không có sản phẩm còn hàng.',
          sources: [] as ProductSource[],
        });
      }

      const product = products[0];
      const subject = productType
        ? `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}`
        : 'Sản phẩm';

      return c.json({
        answer:
          `${subject} ${askCheapest ? 'rẻ nhất' : 'có giá cao nhất'} hiện đang còn hàng là ` +
          `${product.name}, giá ${formatPrice(product.price)}. ` +
          `Hiện còn ${product.stock} sản phẩm.` +
          (products.length > 1
            ? ` Tôi hiển thị thêm các ${typeLabel} có mức giá gần nhất để bạn tham khảo.`
            : ''),
        sources: toSources(products),
      });
    }

    // =================================================
    // 15. TÌM SẢN PHẨM DƯỚI NGÂN SÁCH
    // Ví dụ: dưới 2 triệu, màn hình dưới 5 triệu
    // =================================================

    const money = extractMoney(message);

    if (
      money !== null &&
      (
        q.includes('duoi') ||
        q.includes('khong qua') ||
        q.includes('toi da')
      )
    ) {
      const products = (
        await getInStockProducts(c.env, productType)
      )
        .filter((product) => product.price <= money)
        .sort((a, b) => b.price - a.price)
        .slice(0, 8);

      if (products.length === 0) {
        return c.json({
          answer:
            `Hiện tôi chưa tìm thấy ${typeLabel} còn hàng có giá không quá ${formatPrice(money)}.`,
          sources: [] as ProductSource[],
        });
      }

      // Cho AI tư vấn dựa trên những sản phẩm
      // thực sự nằm trong ngân sách.
      const answer =
        await generateProductAnswer(
          c.env.AI,
          products,
          message
        );

      return c.json({
        answer,
        sources: toSources(products),
      });
    }

    // =================================================
    // 16. SẢN PHẨM CÒN HÀNG
    // =================================================

    if (
      q === 'con hang' ||
      q.includes('san pham con hang') ||
      q.includes('nhung san pham con hang')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock > 0
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      return c.json({
        answer:
          products.length > 0
            ? `Dưới đây là ${products.length} sản phẩm đang còn hàng.`
            : 'Hiện tại chưa có sản phẩm còn hàng.',
        sources: toSources(products),
      });
    }

    // =================================================
    // 17. SẢN PHẨM HẾT HÀNG
    // =================================================

    if (
      q.includes('het hang') ||
      q.includes('san pham het hang')
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        WHERE p.stock <= 0
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại tôi không thấy sản phẩm nào hết hàng.',
          sources: [],
        });
      }

      return c.json({
        answer:
          `Có ${products.length} sản phẩm đang hết hàng.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 18. LIỆT KÊ SẢN PHẨM
    // =================================================

    const listQuestions = [
      'co nhung san pham nao',
      'co san pham nao',
      'cua hang co nhung san pham nao',
      'shop co nhung san pham nao',
      'shop co san pham nao',
      'xem san pham',
      'xem cac san pham',
      'danh sach san pham',
      'san pham cua cua hang',
      'san pham cua shop',
      'cho toi xem san pham',
      'cho xem san pham',
      'tat ca san pham',
    ];

    if (
      listQuestions.some(
        (item) =>
          q === item ||
          q.includes(item)
      )
    ) {
      const products = await getProducts(
        c.env,
        `
        ${PRODUCT_SELECT}
        ORDER BY p.id DESC
        LIMIT 8
        `
      );

      if (products.length === 0) {
        return c.json({
          answer:
            'Hiện tại cửa hàng chưa có sản phẩm.',
          sources: [],
        });
      }

      return c.json({
        answer:
          `Tôi đang hiển thị ${products.length} sản phẩm của cửa hàng. ` +
          `Bạn có thể hỏi tôi về giá, tồn kho hoặc nhờ tôi tư vấn và so sánh.`,
        sources: toSources(products),
      });
    }

    // =================================================
    // 19. HOT / BÁN CHẠY
    // =================================================

    if (
      q.includes('hot nhat') ||
      q.includes('san pham hot') ||
      q.includes('ban chay nhat') ||
      q.includes('pho bien nhat')
    ) {
      /*
       * KHÔNG tự bịa sản phẩm hot.
       *
       * Bước tiếp theo có thể JOIN bảng orders /
       * order_items để tính SUM(quantity).
       */

      return c.json({
        answer:
          'Sản phẩm hot/bán chạy cần được xác định từ dữ liệu đơn hàng và số lượng thực tế đã bán. ' +
          'Hiện tôi chưa sử dụng dữ liệu doanh số để xếp hạng nên sẽ không tự chọn một sản phẩm ngẫu nhiên. ' +
          'Bạn có thể hỏi tôi về sản phẩm rẻ nhất, giá, tồn kho, so sánh hoặc sản phẩm phù hợp với nhu cầu.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 20. RAG
    //
    // Các câu như:
    // - Có chuột Logitech không?
    // - Tìm bàn phím gaming
    // - Màn hình cho chơi game
    // - So sánh A với B
    // - A hay B tốt hơn?
    // - Tư vấn sản phẩm
    // =================================================

    const matches =
      await searchProducts(
        c.env,
        message
      );

    if (matches.length === 0) {
      return c.json({
        answer:
          NO_PRODUCT_ANSWER ||
          'Tôi chưa tìm thấy sản phẩm phù hợp. Hãy thử cho tôi biết loại sản phẩm, hãng, ngân sách hoặc nhu cầu sử dụng.',
        sources: [] as ProductSource[],
      });
    }

    // =================================================
    // 21. AI TẠO CÂU TRẢ LỜI
    // Nếu câu hỏi nhắc tới loại sản phẩm (vd: màn hình),
    // bỏ các kết quả vector thuộc loại khác.
    // =================================================

    const retrieved =
      matches.map(
        (match) => match.product
      );

    const sameType = productType
      ? retrieved.filter((product) =>
          matchesProductType(product, productType)
        )
      : retrieved;

    const products =
      sameType.length > 0 ? sameType : retrieved;

    const answer =
      await generateProductAnswer(
        c.env.AI,
        products,
        message
      );

    // =================================================
    // 22. TRẢ KẾT QUẢ
    // =================================================

    return c.json({
      answer,
      sources: toSources(products),
    });
  } catch (error) {
    console.error(
      'Product chat failed:',
      error
    );

    return c.json(
      {
        error:
          'Chatbot tạm thời không khả dụng. Hãy kiểm tra D1, Workers AI và Vectorize trong log Worker.',
      },
      503
    );
  }
});

export default chat;