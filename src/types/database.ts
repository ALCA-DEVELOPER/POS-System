export type UserRole = "owner" | "cashier" | "kitchen";

export type IngredientUnit = "gram" | "ml" | "pcs" | "kg" | "liter";

export type ProductCategory = "Makanan" | "Minuman" | "Paket" | "Topping";

export type PaymentMethod = "cash" | "qris" | "transfer";

export type OrderType = "dine_in" | "takeaway" | "online";

export type ExpenseCategory =
  | "Bahan Baku"
  | "Kemasan"
  | "Sewa"
  | "Gaji"
  | "Listrik"
  | "Operasional";

export type MovementType = "purchase" | "sale_deduct" | "waste" | "adjustment";

export interface Profile {
  id: string;
  business_id: string;
  business_name: string;
  owner_name: string;
  full_name: string;
  role: UserRole;
  phone: string;
  address: string;
  logo_url: string | null;
  qris_image_url: string | null;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  tax_rate: number;
  service_charge_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorePosConfig {
  business_id: string;
  business_name: string;
  phone: string;
  address: string;
  logo_url: string | null;
  qris_image_url: string | null;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  tax_rate: number;
  service_charge_rate: number;
}

export interface Ingredient {
  id: string;
  user_id: string;
  name: string;
  unit: IngredientUnit;
  current_stock: number;
  minimum_stock: number;
  cost_per_unit: number;
  nearest_expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface KitchenIngredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  current_stock: number;
  minimum_stock: number;
  nearest_expiry_date: string | null;
  updated_at: string;
}

export interface Product {
  id: string;
  user_id: string;
  name: string;
  price: number;
  category: ProductCategory;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecipeItem {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity_needed: number;
  ingredient?: Ingredient;
}

export interface ProductWithHpp extends Product {
  recipes: RecipeItem[];
  hpp: number;
  gross_margin_amount: number;
  gross_margin_percent: number;
}

export interface CashierShift {
  id: string;
  user_id: string;
  cashier_id: string;
  opening_cash: number;
  expected_cash: number;
  actual_cash: number | null;
  cash_difference: number | null;
  status: "open" | "closed";
  notes: string;
  opened_at: string;
  closed_at: string | null;
}

export interface ShiftSummary {
  shift_id: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number;
  actual_cash: number | null;
  cash_difference: number | null;
  order_count: number;
  cash_sales: number;
  qris_sales: number;
  transfer_sales: number;
  total_sales: number;
}

export interface OrderItem {
  id: string;
  order_id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_hpp?: number;
  subtotal: number;
}

export interface Order {
  id: string;
  user_id?: string;
  cashier_id?: string;
  shift_id?: string | null;
  order_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  service_amount: number;
  total_amount: number;
  hpp_total?: number;
  amount_paid: number;
  change_amount: number;
  payment_method: PaymentMethod;
  order_type: OrderType;
  customer_phone: string | null;
  notes?: string;
  created_at: string;
  items?: OrderItem[];
}

export interface ExpenseItem {
  id: string;
  expense_id: string;
  ingredient_id: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  stock_conversion_factor: number;
  unit_price: number;
  subtotal: number;
}

export interface Expense {
  id: string;
  user_id: string;
  supplier_name: string;
  category: ExpenseCategory;
  description: string;
  tax_amount: number;
  discount_amount: number;
  amount: number;
  payment_source: "cash" | "bank" | "qris";
  receipt_image_url: string | null;
  expense_date: string;
  created_at: string;
  expense_items?: ExpenseItem[];
}

export interface StockMovement {
  id: string;
  user_id: string;
  ingredient_id: string;
  actor_id: string | null;
  movement_type: MovementType;
  quantity_delta: number;
  unit_cost: number | null;
  reference_id: string | null;
  notes: string;
  created_at: string;
  ingredient?: { name: string; unit: IngredientUnit };
}

export type CapitalEntryType = "deposit" | "withdrawal";

export interface CapitalEntry {
  id: string;
  user_id: string;
  entry_type: CapitalEntryType;
  amount: number;
  payment_source: "cash" | "bank" | "qris";
  notes: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
}

export type CustomerPaymentStatus = "pending" | "paid" | "rejected";
export type CustomerFulfillmentStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export interface CustomerOrder {
  id: string;
  business_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: "qris";
  payment_status: CustomerPaymentStatus;
  fulfillment_status: CustomerFulfillmentStatus;
  notes: string;
  linked_order_id: string | null;
  paid_verified_at: string | null;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicStorefrontProduct {
  id: string;
  name: string;
  price: number;
  category: ProductCategory;
  image_url: string | null;
}

export interface PublicStorefrontData {
  businessId: string;
  businessName: string;
  phone: string;
  address: string;
  logoUrl: string | null;
  qrisImageUrl: string | null;
  product: PublicStorefrontProduct | null;
  ordersTableMissing?: boolean;
}
