import { NavLink } from 'react-router-dom'

export default function NavBar() {
  return (
    <nav className="nav">
      <div className="nav__inner">
        <div className="nav__brand">KinetiQ</div>
        <div className="nav__links">
          <NavLink to="/" className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}>
            Home
          </NavLink>
          <NavLink to="/fleets" className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}>
            Fleets
          </NavLink>
          <NavLink to="/deliveries/completed" className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}>
            Completed
          </NavLink>
          <NavLink to="/create" className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}>
            Create
          </NavLink>
        </div>
      </div>
    </nav>
  )
}

