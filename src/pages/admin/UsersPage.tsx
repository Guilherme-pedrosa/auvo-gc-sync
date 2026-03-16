import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Loader2, Shield, User } from "lucide-react";

interface UserProfile {
  id: string;
  nome: string;
  email: string;
  gc_user_id: string | null;
  auvo_user_id: string | null;
  role: string;
}

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [gcUserId, setGcUserId] = useState("");
  const [auvoUserId, setAuvoUserId] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nome, email, gc_user_id, auvo_user_id");

    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (profiles) {
      const rolesMap = new Map(roles?.map((r) => [r.user_id, r.role]) ?? []);
      setUsers(
        profiles.map((p) => ({
          ...p,
          role: rolesMap.get(p.id) ?? "user",
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    const { data: { session } } = await supabase.auth.getSession();

    const res = await supabase.functions.invoke("admin-create-user", {
      body: { email, password, nome, role, gc_user_id: gcUserId || null, auvo_user_id: auvoUserId || null },
    });

    setCreating(false);

    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Erro ao criar usuário");
      return;
    }

    toast.success(`Usuário ${nome} criado com sucesso!`);
    setDialogOpen(false);
    setNome("");
    setEmail("");
    setPassword("");
    setRole("user");
    setGcUserId("");
    setAuvoUserId("");
    fetchUsers();
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gerenciar Usuários</h1>
          <p className="text-sm text-muted-foreground">Crie e gerencie contas de acesso ao sistema</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Novo Usuário
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Novo Usuário</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" required />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>ID GestãoClick</Label>
                  <Input value={gcUserId} onChange={(e) => setGcUserId(e.target.value)} placeholder="Opcional" />
                </div>
                <div className="space-y-2">
                  <Label>ID Auvo</Label>
                  <Input value={auvoUserId} onChange={(e) => setAuvoUserId(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Criar Usuário
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>ID GC</TableHead>
                <TableHead>ID Auvo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum usuário cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                        {u.role === "admin" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {u.role === "admin" ? "Admin" : "Usuário"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.gc_user_id || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.auvo_user_id || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
