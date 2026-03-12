import { useParams } from "react-router-dom";
import { marked } from "marked";

export default function BlogPost() {
    const { slug } = useParams();

    const modules = import.meta.glob("/content/blog/*.md", {
        as: "raw",
        eager: true,
    });

    const file = Object.entries(modules).find(([path]) =>
        path.includes(`${slug}.md`)
    );

    if (!file) return <div>Not found</div>;

    const html = marked.parse(file[1] as string);

    return (
        <div className="max-w-3xl mx-auto py-12 px-4">
            <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}