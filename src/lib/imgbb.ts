export async function uploadToImgBB(file: File): Promise<string> {
  const apiKey = import.meta.env.VITE_IMGBB_API_KEY;
  const form = new FormData();
  form.append('image', file);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message ?? 'ImgBB upload failed');
  return data.data.url as string;
}
