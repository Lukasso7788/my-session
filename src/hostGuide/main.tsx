// Entry of /host-guide (host-guide/index.html). The demo client must be
// installed before any module that imports src/lib/supabase, so it is the
// first import; everything that touches Supabase is loaded after it.
import { setDemoHost } from "./demoClient";
import { loadGuideVisitor } from "./visitor";
import "../index.css";
import "../pages/livekit/room-chrome-motion.css";

async function start() {
  const visitor = await loadGuideVisitor();
  setDemoHost(visitor.name, visitor.avatar);
  const [{ createRoot }, { MemoryRouter }, { AuthProvider }, { default: HostGuide }] = await Promise.all([
    import("react-dom/client"),
    import("react-router-dom"),
    import("../context/AuthContext"),
    import("./HostGuidePage"),
  ]);
  createRoot(document.getElementById("root")!).render(
    <MemoryRouter>
      <AuthProvider>
        <HostGuide visitor={visitor} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

void start();
