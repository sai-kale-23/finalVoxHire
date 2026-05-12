import { useState, useEffect } from "react";

interface TechIconsProps {
  techStack: string[];
  maxDisplay?: number;
}

const techIconBaseURL = "https://cdn.jsdelivr.net/gh/devicons/devicon/icons";

const mappings: Record<string, string> = {
  react: "react",
  reactjs: "react",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  java: "java",
  nodejs: "nodejs",
  node: "nodejs",
  nextjs: "nextjs",
  next: "nextjs",
  vue: "vuejs",
  vuejs: "vuejs",
  angular: "angularjs",
  svelte: "svelte",
  tailwind: "tailwindcss",
  tailwindcss: "tailwindcss",
  css: "css3",
  html: "html5",
  mongodb: "mongodb",
  postgresql: "postgresql",
  mysql: "mysql",
  firebase: "firebase",
  aws: "amazonwebservices",
  docker: "docker",
  git: "git",
  github: "github",
  graphql: "graphql",
  redux: "redux",
  sass: "sass",
  webpack: "webpack",
  vite: "vitejs",
  flutter: "flutter",
  swift: "swift",
  kotlin: "kotlin",
  rust: "rust",
  go: "go",
  golang: "go",
  csharp: "csharp",
  c: "c",
  cplusplus: "cplusplus",
  cpp: "cplusplus",
  ruby: "ruby",
  php: "php",
  django: "django",
  flask: "flask",
  express: "express",
  spring: "spring",
  dotnet: "dotnetcore",
};

const normalizeTechName = (tech: string): string => {
  const key = tech.toLowerCase().replace(/\.js$/, "").replace(/\s+/g, "");
  return mappings[key] || key;
};

const TechIcons = ({ techStack, maxDisplay = 4 }: TechIconsProps) => {
  const [logos, setLogos] = useState<{ tech: string; url: string }[]>([]);

  useEffect(() => {
    const loadLogos = async () => {
      const logoPromises = techStack.slice(0, maxDisplay).map(async (tech) => {
        const normalized = normalizeTechName(tech);
        const url = `${techIconBaseURL}/${normalized}/${normalized}-original.svg`;
        
        try {
          const response = await fetch(url, { method: "HEAD" });
          return {
            tech,
            url: response.ok ? url : "",
          };
        } catch {
          return { tech, url: "" };
        }
      });

      const results = await Promise.all(logoPromises);
      setLogos(results);
    };

    loadLogos();
  }, [techStack, maxDisplay]);

  const remaining = techStack.length - maxDisplay;

  return (
    <div className="flex items-center gap-2">
      {logos.map(({ tech, url }) => (
        <div key={tech} className="relative group">
          <div className="size-8 rounded-lg bg-dark-200 border border-border flex items-center justify-center overflow-hidden hover:border-primary-200/50 transition-colors duration-200">
            {url ? (
              <img
                src={url}
                alt={tech}
                className="size-5 object-contain"
              />
            ) : (
              <span className="text-xs font-medium text-muted-foreground uppercase">
                {tech.slice(0, 2)}
              </span>
            )}
          </div>
          <span className="tech-tooltip whitespace-nowrap">{tech}</span>
        </div>
      ))}
      {remaining > 0 && (
        <div className="size-8 rounded-lg bg-dark-200 border border-border flex items-center justify-center">
          <span className="text-xs font-medium text-muted-foreground">
            +{remaining}
          </span>
        </div>
      )}
    </div>
  );
};

export default TechIcons;
