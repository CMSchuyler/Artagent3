export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { path, signatureParams, data } = await req.json();
  const url = `https://openapi.liblibai.cloud${path}?${signatureParams}`;

  const headers = new Headers({
    'content-type': 'application/json',
    'referer': 'https://openapi.liblibai.cloud',
    'origin': 'https://openapi.liblibai.cloud'
  });

  const apiRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
    redirect: 'manual',
  });

  const resHeaders = new Headers(apiRes.headers);

  return new Response(apiRes.body, {
    status: apiRes.status,
    headers: resHeaders,
  });
} 
