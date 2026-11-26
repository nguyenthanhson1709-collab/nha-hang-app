// Đã chép xong dữ liệu từ hoadon-app (26.11.2026): 74 khách, 474 món, văn bản mẫu. Function không còn dùng.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
