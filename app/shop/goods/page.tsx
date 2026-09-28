import { redirect } from "next/navigation";

/** Customer goods moved into Goods & receiving. */
export default function CustomerGoods() {
  redirect("/shop/receiving?view=customer");
}
