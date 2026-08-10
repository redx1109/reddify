export default async function handler(req, res) {
  const { id } = req.query;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,status&id=${id}&key=${process.env.YT_KEY}`;
  const r = await fetch(url);
  const data = await r.json();
  res.status(200).json(data);
}