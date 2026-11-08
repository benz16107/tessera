// Privacy and Terms, linked from every Simple screen. Plain statements of what the service stores and sends where.
import { navigate } from '../App.tsx';
import { Wordmark, LegalLinks } from './Drop.tsx';
import './simple.css';

export default function Legal({ page }: { page: 'privacy' | 'terms' }) {
  return (
    <div className="simple s-legalpage">
      <header className="s-top s-top-home"><Wordmark /><button className="s-pill quiet" onClick={() => navigate('/')}>Start a shoot</button></header>
      <main className="s-prose">
        {page === 'privacy' ? <Privacy /> : <Terms />}
        <p className="s-muted small">Written for the HackUTD 2026 build, November 8, 2026.</p>
      </main>
      <footer className="s-foot"><LegalLinks /></footer>
    </div>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p>Tessera is a hackathon project. This page says what it keeps and who it shares it with.</p>
      <h2>What we store</h2>
      <ul>
        <li><b>Photos you add.</b> Stored on our server and our storage bucket so everyone in the shoot can see them. We keep the photo's location and focal length from its metadata to find the spot, and drop the rest.</li>
        <li><b>The shoot.</b> Its title, the name you give, the people and props you place, the camera settings, messages and AI renders live in our SpacetimeDB database, visible only to people in that shoot.</li>
        <li><b>Your position, only on the camera page.</b> While "Take me there" or the scout page is open, your location and compass heading are shared with the shoot so friends can see you walk. Closing the page stops it.</li>
        <li><b>Invites.</b> A phone number or email you enter to invite someone is stored with the shoot and used only to message that person about it.</li>
      </ul>
      <h2>Who processes it</h2>
      <ul>
        <li>NVIDIA hosted models read photos and the words you type or say, to place objects, make renders and check them.</li>
        <li>Vultr hosts our servers and some models. OpenAI is a fallback for image edits when the NVIDIA path fails.</li>
        <li>Photon delivers invites and messages on iMessage, SMS, WhatsApp, Telegram and email. ElevenLabs runs the phone call.</li>
        <li>Google Photorealistic 3D Tiles draw the 3D view. Google receives the map requests, never your photo.</li>
        <li>Street View, when you pick it behind Cam A, sends Cam A's location to Google to find a nearby panorama. Never your photo.</li>
      </ul>
      <h2>Deleting</h2>
      <p>The person who started a shoot can delete it from Share. That removes its photos, renders, people and messages from the database.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms</h1>
      <ul>
        <li>Tessera is a demo built at HackUTD 2026. It can be offline or lose data, and comes with no warranty.</li>
        <li>Only add photos you took or are allowed to use. Credit the photographer when you share a result made from someone else's photo.</li>
        <li>Renders are AI interpretations of your photo. They are not records of a real moment, so do not present them as one.</li>
        <li>The 3D view uses Google Map Tiles under Google's terms. Map imagery is shown for planning only and never enters a render or an export.</li>
        <li>Do not use Tessera to follow or locate people who have not joined your shoot.</li>
      </ul>
    </>
  );
}
