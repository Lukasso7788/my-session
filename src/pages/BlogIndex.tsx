import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type PostMeta = {
    slug: string;
    title: string;
    description: string;
    date: string;
};

export default function BlogIndex() {
    const [posts, setPosts] = useState<PostMeta[]>([]);

    useEffect(() => {
        async function load() {
            const modules = import.meta.glob("/content/blog/*.md", {
                as: "raw",
                eager: true,
            });

            const data = Object.entries(modules).map(([path, raw]: any) => {
                const slug = path.split("/").pop()?.replace(".md", "") || "";
                const match = raw.match(/title:\s*(.*)/);
                const desc = raw.match(/description:\s*(.*)/);
                const date = raw.match(/date:\s*(.*)/);

                return {
                    slug,
                    title: match?.[1] || slug,
                    description: desc?.[1] || "",
                    date: date?.[1] || "",
                };
            });

            setPosts(data);
        }

        load();
    }, []);

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-3xl font-semibold mb-6">Blog</h1>

            <div className="space-y-6">
                {posts.map((p) => (
                    <Link key={p.slug} to={`/blog/${p.slug}`}>
                        <div className="p-5 rounded-xl border border-white/10 hover:bg-white/5 transition">
                            <h2 className="text-xl font-medium">{p.title}</h2>
                            <p className="text-sm opacity-70 mt-1">{p.description}</p>
                            <div className="text-xs opacity-50 mt-2">{p.date}</div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}