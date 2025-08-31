// src/components/Dashboard.tsx
import '../styles/dashboard.css'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  return (
    <div className="landing">
      <header className="landing__topbar">
        <button className="btn btn--pill">Logout</button>
      </header>

      <main className="landing__main container">
        <h1 className="hero__title">
          Welcome <span className="accent">admin</span> <span className="wave">👋</span>
        </h1>
        <p className="hero__subtitle">Pick a section to get started.</p>

        <section className="cards-grid">
          <Link to="/map" className="service-card link-card">
            <div className="service-card__icon">🗺️</div>
            <h3 className="service-card__title">Map</h3>
            <p className="service-card__desc">View zones & routes</p>
          </Link>

          <Link to="/routes" className="service-card link-card">
            <div className="service-card__icon">🧭</div>
            <h3 className="service-card__title">Route Planning</h3>
            <p className="service-card__desc">Create paths & ETAs</p>
          </Link>

          <Link to="/drivers" className="service-card link-card">
            <div className="service-card__icon">👤</div>
            <h3 className="service-card__title">Driver Profiles</h3>
            <p className="service-card__desc">Add / manage drivers</p>
          </Link>

          <article className="service-card">
            <div className="service-card__icon">⚙️</div>
            <h3 className="service-card__title">Settings</h3>
            <p className="service-card__desc">Preferences & options</p>
          </article>
        </section>
      </main>
    </div>
  )
}
