import fetch from 'node-fetch';

async function run() {
  console.log('--- Diagnostic for RIVN via API ---');
  
  const port = 8080;
  const baseUrl = `http://localhost:${port}`;
  
  try {
    const res = await fetch(`${baseUrl}/market/earnings-date?symbol=RIVN`);
    if (res.ok) {
      const data = await res.json();
      console.log('Earnings Date Result:', JSON.stringify(data, null, 2));
    } else {
      console.log('API returned non-200 status:', res.status);
    }
  } catch (err) {
    console.error('Failed to connect to local API server:', err.message);
  }
}

run();
