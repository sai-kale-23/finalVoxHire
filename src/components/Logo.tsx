import { Link } from "react-router-dom";

const Logo = () => {
  return (
    <Link to="/" className="flex items-center gap-2 group">
      <div className="relative size-10 rounded-xl bg-gradient-to-br from-primary-200 to-accent flex items-center justify-center shadow-lg group-hover:shadow-primary-200/30 transition-all duration-300">
        <span className="text-dark-100 font-bold text-lg">V</span>
      </div>
      <span className="text-xl font-bold text-foreground group-hover:text-primary-200 transition-colors duration-300">
        Voxhire ai
      </span>
    </Link>
  );
};

export default Logo;
